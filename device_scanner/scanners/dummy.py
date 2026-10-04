"""Synthetic WiGLE observations for a repeatable, changing building demo.

Each Pi initially hears eight Wi-Fi and twelve Bluetooth addresses. Three Wi-Fi
and five Bluetooth addresses are shared with neighboring Pis. The seventh scan
adds a new local address. Scans 12–13 of each 24-scan cycle omit one local address
before it reappears; random measurement noise does not change this schedule.
"""

import asyncio
import hashlib
import random

from ..wigle import new_record, utc_timestamp, validate_record


# Discovery and scenario state last for this process, as with the real scanners.
_first_seen = {}
_signal_drift = {}
_scan_numbers = {}
_random = random.Random()

# Wi-Fi profiles: name, capabilities, channel, frequency in MHz.
_WIFI_SHARED = (
    ("Building Wi-Fi", "[WPA2-PSK-CCMP][ESS]", 1, 2412),
    ("Building Wi-Fi", "[WPA2-PSK-CCMP][ESS]", 36, 5180),
    ("Guest Wi-Fi", "[ESS]", 6, 2437),
)
_WIFI_LOCAL = (
    ("Office Wi-Fi", "[WPA2-PSK-CCMP][ESS]", 11, 2462),
    ("Meeting room", "[WPA2-PSK-CCMP][ESS]", 44, 5220),
    ("", "[WPA2-PSK-CCMP][ESS]", 6, 2437),
    ("Lab Wi-Fi", "[WPA2-PSK-CCMP][ESS]", 1, 5955),
    ("Mobile hotspot", "[WPA2-PSK-CCMP][ESS]", 149, 5745),
)
_WIFI_NEW = ("Visitor hotspot", "[WPA2-PSK-CCMP][ESS]", 11, 2462)

# Bluetooth profiles: name, advertised icon, transport, device class, company ID.
# Frequency is a Bluetooth device-class code in WiGLE, not a radio frequency.
_BT_SHARED = (
    ("Lobby speaker", "audio-speakers", "BT", 1044, 117),
    ("Reception computer", "computer", "BT", 256, 6),
    ("Building beacon", "Misc", "BLE", 7936, 72),
    ("Office tablet", "computer", "BLE", 256, 76),
    ("Meeting headset", "audio-headset", "BT", 1028, 117),
)
_BT_LOCAL = (
    ("Phone", "phone", "BLE", 512, 76),
    ("Headphones", "audio-headset", "BT", 1048, 117),
    ("Laptop", "computer", "BT", 268, 6),
    ("Keyboard", "input-keyboard", "BLE", 1344, 89),
    ("Mouse", "input-mouse", "BLE", 1408, 89),
    ("Watch", "watch", "BLE", 1796, 76),
    ("Portable speaker", "audio-speakers", "BT", 1044, 117),
)
_BT_NEW = ("Visitor phone", "phone", "BLE", 512, 76)


def noisy_signal(key, baseline):
    """Simulate slow drift, small measurement jitter, and occasional fading."""
    drift = _signal_drift.get(key, 0) * 0.85 + _random.uniform(-3, 3)
    drift = max(-10, min(10, drift))
    _signal_drift[key] = drift
    signal = baseline + drift + _random.uniform(-2, 2)
    if _random.random() < 0.08:
        signal -= _random.uniform(8, 18)
    return round(max(-100, min(-25, signal)), 1)


def profiles(node_id, radio, scan_number):
    """Keep identity/order stable while making arrivals and gaps reproducible."""
    wifi = radio == "wifi"
    local = _WIFI_LOCAL if wifi else _BT_LOCAL
    shared = _WIFI_SHARED if wifi else _BT_SHARED
    for index, profile in enumerate(local):
        if index == len(local) - 1 and (scan_number - 1) % 24 in (11, 12):
            continue
        yield f"node:{node_id}", index, profile
    for index, profile in enumerate(shared):
        yield "shared", index, profile
    if scan_number >= 7:
        yield f"node:{node_id}", len(local), _WIFI_NEW if wifi else _BT_NEW


async def scan(timeout, stop_event=None, *, node_id, radio):
    """Use the same cooperative stop contract as the real scanners."""
    if radio not in ("bluetooth", "wifi"):
        raise ValueError(f"Unknown radio: {radio}")
    stop_event = stop_event if stop_event is not None else asyncio.Event()
    if stop_event.is_set():
        return []
    try:
        await asyncio.wait_for(stop_event.wait(), min(timeout, 0.1))
        return []
    except TimeoutError:
        pass
    key = (node_id, radio)
    scan_number = _scan_numbers.get(key, 0) + 1
    _scan_numbers[key] = scan_number
    # Fictional sensor locations near (0, 0), shared by both radios on a Pi.
    # These coordinates and the manufacturer codes are fixtures, not GPS data.
    position = hashlib.sha256(node_id.encode()).digest()
    wifi = radio == "wifi"
    records = []
    for scope, index, profile in profiles(node_id, radio, scan_number):
        digest = hashlib.sha256(f"dummy:{radio}:{scope}:{index}".encode()).digest()
        address = ":".join(f"{part:02X}" for part in (2, *digest[:5]))
        name = profile[0]
        if scope != "shared" and name:
            name = f"{name} ({node_id})"
        first_seen = _first_seen.setdefault((radio, address), utc_timestamp())
        record = new_record(address, name, "WIFI" if wifi else profile[2], first_seen)
        if wifi:
            record.update(AuthMode=profile[1], Channel=profile[2], Frequency=profile[3])
        else:
            record.update(AuthMode=f"{profile[1]} [{profile[2]}]",
                          Frequency=profile[3], MfgrId=profile[4])
        # One transmitter has independent signal measurements at each receiver.
        receiver = hashlib.sha256(f"{node_id}:{address}".encode()).digest()
        record.update(
            RSSI=noisy_signal((node_id, radio, address), -42 - receiver[0] % 37),
            CurrentLatitude=round(0.01 + int.from_bytes(position[:2]) / 65535 * 0.01, 6),
            CurrentLongitude=round(0.01 + int.from_bytes(position[2:4]) / 65535 * 0.01, 6),
            AltitudeMeters=10 + position[4] % 20,
            AccuracyMeters=round(3 + position[5] % 10 / 10 + _random.uniform(-0.5, 0.5), 1),
        )
        records.append(validate_record(record, radio))
    return records
