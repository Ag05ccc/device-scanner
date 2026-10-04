"""The shared WiGLE v1.6 observation schema and hardware-to-schema adapters.

Reference: https://api.wigle.net/csvFormat.html
Missing measurements are empty strings, just like empty cells in WiGLE CSV.
"""

from datetime import datetime, timezone
import math
import re


COLUMNS = (
    "MAC", "SSID", "AuthMode", "FirstSeen", "Channel", "Frequency", "RSSI",
    "CurrentLatitude", "CurrentLongitude", "AltitudeMeters", "AccuracyMeters",
    "RCOIs", "MfgrId", "Type",
)
MAC_PATTERN = re.compile(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\Z")


def utc_timestamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def new_record(mac, name, kind, first_seen=None):
    """Create all fourteen columns in CSV order, with explicit missing values."""
    record = dict.fromkeys(COLUMNS, "")
    record.update(MAC=mac.upper(), SSID=name or "", Type=kind,
                  FirstSeen=first_seen if first_seen is not None else utc_timestamp())
    if kind in ("BT", "BLE"):
        record["Channel"] = 0
    return record


def validate_record(record, radio):
    if not isinstance(record, dict) or set(record) != set(COLUMNS):
        raise ValueError("Each observation must contain exactly the 14 WiGLE v1.6 fields")
    if not isinstance(record["MAC"], str) or not MAC_PATTERN.fullmatch(record["MAC"]):
        raise ValueError("MAC must be a colon-separated six-byte address")
    for field in ("SSID", "AuthMode", "FirstSeen", "RCOIs", "Type"):
        if not isinstance(record[field], str):
            raise ValueError(f"{field} must be a string")
    kinds = ("WIFI",) if radio == "wifi" else ("BT", "BLE")
    if record["Type"] not in kinds:
        raise ValueError(f"Type must be {' or '.join(kinds)} for {radio}")
    stamp = record["FirstSeen"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", stamp):
        raise ValueError("FirstSeen must be YYYY-MM-DD hh:mm:ss in UTC")
    datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")
    for field in ("Channel", "Frequency", "AltitudeMeters", "MfgrId"):
        value = record[field]
        if value != "" and type(value) is not int:
            raise ValueError(f"{field} must be an integer or blank")
        if field != "AltitudeMeters" and value != "" and value < 0:
            raise ValueError(f"{field} must not be negative")
    for field in ("RSSI", "CurrentLatitude", "CurrentLongitude", "AccuracyMeters"):
        value = record[field]
        if value != "" and (type(value) not in (int, float) or not math.isfinite(value)):
            raise ValueError(f"{field} must be a finite number or blank")
    for field, limit in (("CurrentLatitude", 90), ("CurrentLongitude", 180)):
        if record[field] != "" and abs(record[field]) > limit:
            raise ValueError(f"{field} is out of range")
    if (record["CurrentLatitude"] == "") != (record["CurrentLongitude"] == ""):
        raise ValueError("Latitude and longitude must both be supplied or both blank")
    if record["AccuracyMeters"] != "" and record["AccuracyMeters"] < 0:
        raise ValueError("AccuracyMeters must not be negative")
    if record["MfgrId"] != "" and record["MfgrId"] > 65535:
        raise ValueError("MfgrId must be a 16-bit manufacturer identifier")
    if radio == "bluetooth" and (record["Channel"] != 0 or record["RCOIs"] != ""):
        raise ValueError("Bluetooth requires Channel 0 and blank RCOIs")
    if radio == "wifi" and record["MfgrId"] != "":
        raise ValueError("Wi-Fi requires blank MfgrId")
    return record


def wifi_auth_mode(props):
    """Encode advertised NetworkManager flags as WiGLE capability groups."""
    values = [props.get(key) for key in ("Flags", "WpaFlags", "RsnFlags")]
    if any(type(value) is not int for value in values):
        return ""
    flags, wpa, rsn = values
    groups = []
    for protocol, bits in (("WPA", wpa), ("WPA2", rsn)):
        if not bits:
            continue
        ciphers = [name for bit, name in ((1, "WEP40"), (2, "WEP104"), (4, "TKIP"), (8, "CCMP")) if bits & bit]
        auth = [name for bit, name in ((0x100, "PSK"), (0x200, "EAP"), (0x400, "SAE"),
                (0x800, "OWE"), (0x1000, "OWE_TRANSITION"), (0x2000, "EAP_SUITE_B_192")) if bits & bit]
        groups.append("[" + "-".join(filter(None, (protocol, "+".join(auth), "+".join(ciphers)))) + "]")
    if not groups and flags & 1:
        groups.append("[WEP]")
    if props.get("Mode") in (1, 2):
        groups.append("[IBSS]" if props["Mode"] == 1 else "[ESS]")
    if flags & 2:
        groups.append("[WPS]")
    return "".join(groups)


class HardwareRecords:
    """Keep first discovery times while translating native scanner properties."""

    def __init__(self, radio):
        self.radio = radio
        self.first_seen = {}

    def convert(self, native):
        props = native["properties"]
        wifi = self.radio == "wifi"
        mac = (props.get("BSSID") if wifi else props.get("Address")) or ""
        mac = mac.upper()
        if wifi:
            kind = "WIFI"
        else:
            # BlueZ's auto discovery does not expose a per-result transport.
            # Only LE-specific evidence distinguishes BLE; EIR manufacturer
            # data alone can also come from classic Bluetooth.
            le = props.get("AddressType") == "random" or any(props.get(key) is not None for key in (
                "Appearance", "AdvertisingFlags", "AdvertisingData",
            ))
            kind = "BLE" if le else "BT"
        first_seen = self.first_seen.setdefault(mac, utc_timestamp())
        record = new_record(mac, props.get("SSID") if wifi else props.get("Name"), kind, first_seen)
        # A percentage is not an RSSI measurement. Never convert Strength to dBm.
        rssi = props.get("RSSI")
        record["RSSI"] = rssi if type(rssi) in (int, float) and math.isfinite(rssi) else ""
        if wifi:
            record.update(AuthMode=wifi_auth_mode(props), Channel=props.get("Channel") or "",
                          Frequency=props.get("Frequency") or "")
        else:
            record["AuthMode"] = f"{props.get('Icon') or 'Misc'} [{kind}]"
            # Strip service and format bits, retaining the major/minor class.
            device_class = props.get("Class")
            record["Frequency"] = device_class & 0x1ffc if type(device_class) is int else ""
            manufacturers = props.get("ManufacturerData") or {}
            if len(manufacturers) == 1:
                identifier = next(iter(manufacturers))
                try:
                    record["MfgrId"] = int(str(identifier), 16 if str(identifier).startswith("0x") else 10)
                except (TypeError, ValueError):
                    record["MfgrId"] = ""
        return validate_record(record, self.radio)


def signal_sort_key(record):
    rssi = record["RSSI"]
    return (rssi == "", -rssi if rssi != "" else 0, record["MAC"])


def format_table(records):
    """Use the same field names in standalone scanner terminal output."""
    columns = ("SSID", "MAC", "RSSI", "Channel", "Frequency", "AuthMode", "Type")
    def safe(value):
        return "".join(char if char.isprintable() else repr(char)[1:-1] for char in str(value))
    rows = [list(columns), *[[safe(record[key]) for key in columns] for record in records]]
    widths = [max(len(row[index]) for row in rows) for index in range(len(columns))]
    return "\n".join("  ".join(value.ljust(width) for value, width in zip(row, widths)).rstrip() for row in rows)
