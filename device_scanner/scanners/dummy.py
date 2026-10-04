"""Deterministic observations for running many nodes without radio hardware."""

import asyncio
import hashlib


async def scan(timeout, stop_event=None, *, node_id, radio):
    """Use the same cooperative stop contract as the real scanners."""
    stop_event = stop_event if stop_event is not None else asyncio.Event()
    try:
        await asyncio.wait_for(stop_event.wait(), min(timeout, 0.1))
        return []
    except TimeoutError:
        pass
    digest = hashlib.sha256(f"{node_id}:{radio}".encode()).digest()
    address = ":".join(f"{part:02X}" for part in (2, *digest[:5]))
    path = f"/dummy/{radio}/{address.replace(':', '_')}"
    if radio == "bluetooth":
        properties = {
            "Name": f"Demo beacon ({node_id})", "Address": address,
            "AddressType": "public", "RSSI": -40 - digest[5] % 40,
            "Paired": False, "Connected": False,
        }
    elif radio == "wifi":
        properties = {
            "SSID": f"Demo Wi-Fi ({node_id})", "BSSID": address,
            "Frequency": 2437, "Channel": 6, "Strength": 40 + digest[5] % 50,
            "Security": "WPA2 Personal",
        }
    else:
        raise ValueError(f"Unknown radio: {radio}")
    return [{"path": path, "properties": properties}]
