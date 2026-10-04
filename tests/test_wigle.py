"""Schema, real-driver adaptation and measured signal regression checks."""

import asyncio
import importlib.util
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from device_scanner.scanners import iw
from device_scanner.wigle import COLUMNS, HardwareRecords, validate_record, wifi_auth_mode


class HardwareRecordTests(unittest.TestCase):
    def test_wifi_measurements_capabilities_and_stable_first_seen(self):
        adapter = HardwareRecords("wifi")
        native = {"path": "/nm/ap/1", "properties": {
            "BSSID": "aa:bb:cc:dd:ee:ff", "SSID": "Örnek", "Frequency": 2437,
            "Channel": 6, "Strength": 90, "RSSI": -43.5,
            "Flags": 1, "WpaFlags": 0, "RsnFlags": 0x108, "Mode": 2,
        }}
        with patch("device_scanner.wigle.utc_timestamp", return_value="2026-10-04 12:00:00"):
            first = adapter.convert(native)
        native["properties"]["RSSI"] = -57
        native["path"] = "/nm/ap/2"
        with patch("device_scanner.wigle.utc_timestamp", return_value="2026-10-04 12:01:00"):
            again = adapter.convert(native)
        self.assertEqual(tuple(first), COLUMNS)
        self.assertEqual(first["MAC"], "AA:BB:CC:DD:EE:FF")
        self.assertEqual(first["AuthMode"], "[WPA2-PSK-CCMP][ESS]")
        self.assertEqual(first["RSSI"], -43.5)
        self.assertEqual(again["RSSI"], -57)
        self.assertEqual(first["FirstSeen"], again["FirstSeen"])
        for field in ("CurrentLatitude", "CurrentLongitude", "AltitudeMeters", "AccuracyMeters", "RCOIs", "MfgrId"):
            self.assertEqual(first[field], "")
        del native["properties"]["RSSI"]
        self.assertEqual(adapter.convert(native)["RSSI"], "")

    def test_bluetooth_class_manufacturer_and_published_name(self):
        adapter = HardwareRecords("bluetooth")
        native = {"properties": {
            "Address": "aa:bb:cc:dd:ee:ff", "Name": "Beacon", "Alias": "Local nickname",
            "RSSI": -60, "AddressType": "random", "Class": 0x201f00,
            "ManufacturerData": {"0x004c": "abcd"},
        }}
        record = adapter.convert(native)
        self.assertEqual(record["Type"], "BLE")
        self.assertEqual(record["SSID"], "Beacon")
        self.assertEqual(record["Channel"], 0)
        self.assertEqual(record["Frequency"], 7936)
        self.assertEqual(record["MfgrId"], 76)
        native["properties"].update(AddressType="public", ManufacturerData={"0x004c": "a", "0x0048": "b"})
        record = adapter.convert(native)
        self.assertEqual(record["Type"], "BT")  # Manufacturer data also exists in classic EIR.
        self.assertEqual(record["MfgrId"], "")
        native["properties"]["Appearance"] = 0
        del native["properties"]["Class"]
        del native["properties"]["Name"]
        record = adapter.convert(native)
        self.assertEqual(record["Type"], "BLE")
        self.assertEqual(record["SSID"], "")
        self.assertEqual(record["Frequency"], "")

    def test_open_wep_and_mixed_wifi_capabilities(self):
        props = {"Flags": 0, "WpaFlags": 0, "RsnFlags": 0, "Mode": 2}
        self.assertEqual(wifi_auth_mode(props), "[ESS]")
        self.assertEqual(wifi_auth_mode({**props, "Flags": 1}), "[WEP][ESS]")
        self.assertEqual(wifi_auth_mode({**props, "WpaFlags": 0x104, "RsnFlags": 0x108}),
                         "[WPA-PSK-TKIP][WPA2-PSK-CCMP][ESS]")
        self.assertEqual(wifi_auth_mode({}), "")


IW_OUTPUT = """BSS aa:bb:cc:dd:ee:01(on wlan0)
    freq: 2437
    signal: -43.50 dBm
BSS aa:bb:cc:dd:ee:02(on wlan0) -- associated
    freq: 5180
    signal: 70/100
BSS aa:bb:cc:dd:ee:01(on wlan0)
    freq: 5955
    signal: -67.00 dBm
"""


class IWTests(unittest.IsolatedAsyncioTestCase):
    def test_parser_matches_address_and_frequency_and_ignores_quality(self):
        self.assertEqual(iw.parse_signals(IW_OUTPUT), {
            ("AA:BB:CC:DD:EE:01", 2437): -43.5,
            ("AA:BB:CC:DD:EE:01", 5955): -67,
        })

    async def test_missing_or_denied_iw_leaves_rssi_unknown(self):
        with patch.object(asyncio, "create_subprocess_exec", side_effect=FileNotFoundError):
            self.assertEqual(await iw.read_signals("wlan0"), {})
        process = Mock(returncode=1, communicate=AsyncMock(return_value=(b"", b"")))
        with patch.object(asyncio, "create_subprocess_exec", return_value=process) as launch:
            self.assertEqual(await iw.read_signals("wlan0"), {})
        self.assertEqual(launch.call_args.args, ("iw", "dev", "wlan0", "scan", "dump"))

    async def test_timeout_and_cancellation_reap_child(self):
        for failure in (TimeoutError, asyncio.CancelledError):
            process = Mock(returncode=None, communicate=AsyncMock(side_effect=[failure, (b"", b"")]))
            with patch.object(asyncio, "create_subprocess_exec", return_value=process):
                if failure is asyncio.CancelledError:
                    with self.assertRaises(asyncio.CancelledError):
                        await iw.read_signals("wlan0")
                else:
                    self.assertEqual(await iw.read_signals("wlan0"), {})
            process.kill.assert_called_once()
            self.assertEqual(process.communicate.await_count, 2)


@unittest.skipUnless(importlib.util.find_spec("dbus_fast"), "optional Pi dependencies not installed")
class RealScannerTests(unittest.IsolatedAsyncioTestCase):
    async def test_wifi_scan_joins_measured_rssi_and_emits_only_wigle(self):
        from device_scanner.scanners import wifi
        disconnected = asyncio.Event()
        bus = Mock(connect=AsyncMock(), wait_for_disconnect=AsyncMock(side_effect=disconnected.wait),
                   disconnect=Mock(side_effect=disconnected.set))
        stamps = iter([100000, 101000])

        async def call(bus, destination, path, interface, method, *args):
            if method == "GetNameOwner":
                return [":1.20"]
            if method == "GetDevices":
                return [["/device/1"]]
            if method == "Get":
                return [next(stamps)]
            if method == "GetAllAccessPoints":
                return [["/ap/1"]]
            if method == "GetAll":
                if path == wifi.NM_PATH:
                    return [{"WirelessEnabled": True, "WirelessHardwareEnabled": True}]
                if path == "/device/1":
                    return [{"DeviceType": 2, "Interface": "wlan0", "Managed": True}]
                return [{"HwAddress": "aa:bb:cc:dd:ee:01", "Ssid": b"Office", "Frequency": 2437,
                         "Strength": 90, "LastSeen": 101, "Mode": 2, "Flags": 1,
                         "WpaFlags": 0, "RsnFlags": 0x108}]
            return []

        with patch.object(wifi, "dbus_call", side_effect=call), patch.object(
            wifi, "read_signals", return_value={("AA:BB:CC:DD:EE:01", 2437): -43.5},
        ) as signals:
            records = await wifi.scan(1, bus_factory=lambda **kw: bus, clock=lambda: 100.5)
        signals.assert_awaited_once_with("wlan0")
        self.assertEqual(len(records), 1)
        record = validate_record(records[0], "wifi")
        self.assertEqual(record["RSSI"], -43.5)
        self.assertEqual(record["SSID"], "Office")
        self.assertEqual(record["Channel"], 6)
        self.assertEqual(json.loads(wifi.format_results(records, True)), records)
        self.assertIn("AuthMode", wifi.format_results(records))
        bus.disconnect.assert_called_once()

    async def test_bluetooth_public_scan_and_callback_share_wire_schema(self):
        from device_scanner.scanners import bluetooth
        native = {"path": "/bluez/device", "properties": {
            "Address": "02:00:00:00:00:01", "Name": "Beacon", "RSSI": -62,
            "AddressType": "random", "ManufacturerData": {"0x0048": "abcd"},
        }}

        async def scan(*args, **kwargs):
            kwargs["on_update"](native)
            return [native]

        updates = []
        with patch.object(bluetooth, "_scan", side_effect=scan):
            records = await bluetooth.scan(0.1, on_update=updates.append)
        self.assertEqual(updates, records)
        self.assertEqual(records[0]["MfgrId"], 72)
        validate_record(records[0], "bluetooth")
        self.assertEqual(json.loads(bluetooth.format_results(records, True)), records)
        self.assertIn("MAC", bluetooth.format_results(records))


if __name__ == "__main__":
    unittest.main()
