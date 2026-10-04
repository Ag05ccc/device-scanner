"""Synthetic WiGLE v1.6 observations, wrapped in the scanner report envelope."""

import asyncio
import hashlib

from ..wigle import utc_timestamp, validate_record


# FirstSeen describes first discovery in this process, not the latest scan time.
_first_seen = {}


async def scan(timeout, stop_event=None, *, node_id, radio):
    """Use the same cooperative stop contract as the real scanners."""
    if radio not in ("bluetooth", "wifi"):
        raise ValueError(f"Unknown radio: {radio}")
    stop_event = stop_event if stop_event is not None else asyncio.Event()
    try:
        await asyncio.wait_for(stop_event.wait(), min(timeout, 0.1))
        return []
    except TimeoutError:
        pass
    digest = hashlib.sha256(f"{node_id}:{radio}".encode()).digest()
    address = ":".join(f"{part:02X}" for part in (2, *digest[:5]))
    first_seen = _first_seen.setdefault(
        (node_id, radio), utc_timestamp(),
    )
    # A small fictional grid near (0, 0), shared by both radios on the same Pi.
    # These coordinates and the manufacturer code below are fixtures, not GPS data.
    position = hashlib.sha256(node_id.encode()).digest()
    wifi = radio == "wifi"
    record = {
        "MAC": address,
        "SSID": f"Demo {'Wi-Fi' if wifi else 'beacon'} ({node_id})",
        "AuthMode": "[WPA2-PSK-CCMP][ESS]" if wifi else "Misc [BLE]",
        "FirstSeen": first_seen,
        "Channel": 6 if wifi else 0,
        # WiGLE overloads Frequency for Bluetooth: this is a device-type code.
        "Frequency": 2437 if wifi else 7936,
        "RSSI": -40 - digest[5] % 40,
        "CurrentLatitude": round(0.01 + int.from_bytes(position[:2]) / 65535 * 0.01, 6),
        "CurrentLongitude": round(0.01 + int.from_bytes(position[2:4]) / 65535 * 0.01, 6),
        "AltitudeMeters": 10 + position[4] % 20,
        "AccuracyMeters": round(3 + position[5] % 10 / 10, 1),
        "RCOIs": "",
        "MfgrId": "" if wifi else 72,
        "Type": "WIFI" if wifi else "BLE",
    }
    return [validate_record(record, radio)]
