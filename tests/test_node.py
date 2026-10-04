import asyncio
import importlib
import random
import unittest
from unittest.mock import AsyncMock, patch

from device_scanner import node
from device_scanner.scanners import dummy
from device_scanner.wigle import COLUMNS, new_record, validate_record


class NodeTests(unittest.IsolatedAsyncioTestCase):
    async def test_dummy_preserves_identity_and_separates_nodes(self):
        first = await dummy.scan(0.001, node_id="pi-1", radio="bluetooth")
        again = await dummy.scan(0.001, node_id="pi-1", radio="bluetooth")
        second = await dummy.scan(0.001, node_id="pi-2", radio="bluetooth")
        self.assertEqual(len(first), 12)
        self.assertEqual(len(again), 12)
        self.assertEqual({record["MAC"] for record in first},
                         {record["MAC"] for record in again})
        stable_fields = set(COLUMNS) - {"RSSI", "AccuracyMeters"}
        self.assertEqual({key: first[0][key] for key in stable_fields},
                         {key: again[0][key] for key in stable_fields})
        self.assertNotEqual(first[0]["MAC"], second[0]["MAC"])
        wifi = await dummy.scan(0.001, node_id="pi-1", radio="wifi")
        self.assertEqual(len(wifi), 8)
        for radio, records in (("wifi", wifi), ("bluetooth", first)):
            for record in records:
                self.assertEqual(tuple(record), COLUMNS)
                validate_record(record, radio)
                self.assertLess(record["RSSI"], 0)
        self.assertEqual(first[0]["Channel"], 0)
        self.assertEqual(first[0]["Type"], "BLE")
        self.assertEqual(wifi[0]["Type"], "WIFI")
        self.assertEqual(wifi[0]["CurrentLatitude"], first[0]["CurrentLatitude"])

    async def test_dummy_measurements_vary_without_changing_device_or_schema(self):
        # A fixed random stream makes the regression repeatable, not probabilistic.
        with patch.object(dummy, "_random", random.Random(42)), patch.object(dummy, "_signal_drift", {}):
            for radio in ("wifi", "bluetooth"):
                records = [(await dummy.scan(0.0001, node_id="pi-noise", radio=radio))[0]
                           for _ in range(80)]
                with self.subTest(radio=radio):
                    self.assertGreater(len({record["RSSI"] for record in records}), 20)
                    self.assertGreater(len({record["AccuracyMeters"] for record in records}), 1)
                    stable_fields = set(COLUMNS) - {"RSSI", "AccuracyMeters"}
                    expected = {key: records[0][key] for key in stable_fields}
                    for record in records:
                        validate_record(record, radio)
                        self.assertTrue(-100 <= record["RSSI"] <= -25)
                        self.assertTrue(2.5 <= record["AccuracyMeters"] <= 4.4)
                        self.assertEqual({key: record[key] for key in stable_fields}, expected)

    def test_dummy_signal_includes_fades_and_recovers(self):
        with patch.object(dummy, "_signal_drift", {}), patch.object(dummy, "_random") as noise:
            noise.uniform.side_effect = [0, 0, 12, 0, 0]
            noise.random.side_effect = [0.01, 0.5]
            self.assertEqual(dummy.noisy_signal(("pi-1", "wifi"), -60), -72)
            self.assertEqual(dummy.noisy_signal(("pi-1", "wifi"), -60), -60)

    async def test_dummy_stop_returns_no_partial_observations(self):
        stop = asyncio.Event()
        stop.set()
        self.assertEqual(await dummy.scan(1, stop, node_id="pi-1", radio="bluetooth"), [])

    async def test_dummy_never_loads_real_dependencies(self):
        with patch.object(importlib, "import_module", side_effect=AssertionError("Unexpected real import")):
            scan = node.load_scan("dummy", "wifi", "pi-1")
            self.assertTrue(await scan(0.001))

    async def test_real_dependency_error_is_actionable_and_never_falls_back(self):
        with patch.object(node.sys, "platform", "linux"), patch.object(
            importlib, "import_module", side_effect=ImportError("No dbus_fast"),
        ) as load:
            with self.assertRaisesRegex(RuntimeError, "requirements-pi.txt"):
                node.load_scan("real", "wifi", "pi-1")
        load.assert_called_once_with("device_scanner.scanners.wifi")

    async def test_scan_failure_does_not_stop_other_radio_or_heartbeat(self):
        stop = asyncio.Event()
        reports = []

        async def failed_scan(*args, **kwargs):
            raise RuntimeError("Bluetooth unavailable")

        async def good_scan(*args, **kwargs):
            return [new_record("02:00:00:00:00:01", "Demo", "WIFI")]

        def load(scanner, radio, node_id):
            return failed_scan if radio == "bluetooth" else good_scan

        async def capture(url, report):
            reports.append(report)
            if len(reports) >= 3:
                stop.set()

        with patch.object(node, "load_scan", side_effect=load), patch.object(
            node, "send_report", side_effect=capture,
        ), self.assertLogs(node.LOG, "WARNING"):
            await asyncio.wait_for(node.run_node(
                node_id="pi-1", server_url="http://127.0.0.1:8001", scanner="real",
                interval=0.01, timeout=0.1, radios=node.RADIOS, stop_event=stop,
            ), 1)
        self.assertTrue(any(report["kind"] == "heartbeat" for report in reports))
        scans = {report["radio"]: report for report in reports if report["kind"] == "scan"}
        self.assertEqual(scans["bluetooth"]["status"], "error")
        self.assertEqual(scans["wifi"]["status"], "success")
        self.assertIn("observed_at", scans["wifi"])

    async def test_stopping_releases_scanner_without_publishing_partial_scan(self):
        stop = asyncio.Event()
        scanning = asyncio.Event()
        cleaned = asyncio.Event()

        async def scan(timeout, stop_event, **kwargs):
            try:
                scanning.set()
                await stop_event.wait()
                return [new_record("02:00:00:00:00:01", "Partial", "BT")]
            finally:
                cleaned.set()

        sender = AsyncMock()
        with patch.object(node, "load_scan", return_value=scan), patch.object(node, "send_report", sender):
            task = asyncio.create_task(node.run_node(
                node_id="pi-1", server_url="http://127.0.0.1:8001", scanner="real",
                interval=1, timeout=15, radios=("bluetooth",), stop_event=stop,
            ))
            await asyncio.wait_for(scanning.wait(), 1)
            stop.set()
            await asyncio.wait_for(task, 1)
        self.assertTrue(cleaned.is_set())
        self.assertTrue(all(call.args[1]["kind"] == "heartbeat" for call in sender.call_args_list))

    async def test_network_failure_does_not_prevent_later_current_report(self):
        first = {"node_id": "pi-1", "kind": "heartbeat"}
        current = {"node_id": "pi-1", "kind": "scan", "radio": "wifi", "status": "success", "observations": []}
        with patch.object(node, "post_report", side_effect=[OSError("offline"), None]) as post:
            with self.assertLogs(node.LOG, "WARNING"):
                await node.send_report("http://127.0.0.1:8001", first)
            await node.send_report("http://127.0.0.1:8001", current)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args.args[1], current)


if __name__ == "__main__":
    unittest.main()
