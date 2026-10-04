"""Repeatable demo scenarios; timing and randomness do not determine arrivals."""

import asyncio
import random
import unittest
from unittest.mock import patch

from device_scanner.scanners import dummy
from device_scanner.wigle import COLUMNS, validate_record


class DummyScenarioTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for attribute in ("_first_seen", "_signal_drift", "_scan_numbers"):
            self.enterContext(patch.object(dummy, attribute, {}))
        self.enterContext(patch.object(dummy, "_random", random.Random(72)))

    async def test_startup_contains_shared_and_local_transmitters_and_varied_types(self):
        for radio, count, overlap in (("wifi", 8, 3), ("bluetooth", 12, 5)):
            with self.subTest(radio=radio):
                with patch.object(dummy, "utc_timestamp", return_value="2026-01-01 12:00:00"):
                    first = await dummy.scan(0, node_id="pi-01", radio=radio)
                with patch.object(dummy, "utc_timestamp", return_value="2026-01-01 12:01:00"):
                    second = await dummy.scan(0, node_id="pi-02", radio=radio)
                by_first = {record["MAC"]: record for record in first}
                by_second = {record["MAC"]: record for record in second}
                shared = by_first.keys() & by_second.keys()
                self.assertEqual(len(by_first), count)
                self.assertEqual(len(by_second), count)
                self.assertEqual(len(shared), overlap)
                self.assertTrue(any(by_first[mac]["RSSI"] != by_second[mac]["RSSI"]
                                    for mac in shared))
                for mac in shared:
                    self.assertEqual(by_first[mac]["FirstSeen"], by_second[mac]["FirstSeen"])
                    self.assertEqual(by_first[mac]["SSID"], by_second[mac]["SSID"])
                    self.assertEqual(by_first[mac]["Type"], by_second[mac]["Type"])
                if radio == "wifi":
                    self.assertTrue(any(record["SSID"] == "" for record in first))
                    self.assertTrue(any(record["AuthMode"] == "[ESS]" for record in first))
                    self.assertGreaterEqual(len({record["Frequency"] for record in first}), 5)
                    # Same SSID on two BSSIDs must remain two separate records.
                    self.assertEqual(sum(record["SSID"] == "Building Wi-Fi" for record in first), 2)
                else:
                    self.assertEqual({record["Type"] for record in first}, {"BT", "BLE"})
                    icons = {record["AuthMode"].split()[0] for record in first}
                    self.assertTrue({"phone", "audio-headset", "computer", "input-keyboard", "watch"} <= icons)

    async def test_arrivals_gaps_and_reappearance_follow_successful_scan_number(self):
        for radio, initial_count in (("wifi", 8), ("bluetooth", 12)):
            observations = []
            for scan_number in range(1, 51):
                timestamp = f"2026-01-01 12:00:{scan_number:02}"
                with patch.object(dummy, "utc_timestamp", return_value=timestamp):
                    records = await dummy.scan(0, node_id="pi-scenario", radio=radio)
                expected = initial_count + (scan_number >= 7)
                if (scan_number - 1) % 24 in (11, 12):
                    expected -= 1
                self.assertEqual(len(records), expected, (radio, scan_number))
                for record in records:
                    self.assertEqual(tuple(record), COLUMNS)
                    validate_record(record, radio)
                    self.assertTrue(-100 <= record["RSSI"] <= -25)
                    self.assertTrue(2.5 <= record["AccuracyMeters"] <= 4.4)
                observations.append({record["MAC"]: record for record in records})
            original = observations[0]
            self.assertEqual(original.keys(), observations[5].keys())
            new = observations[6].keys() - original.keys()
            self.assertEqual(len(new), 1)
            newcomer = observations[6][next(iter(new))]
            self.assertEqual(newcomer["FirstSeen"], "2026-01-01 12:00:07")
            missing = observations[10].keys() - observations[11].keys()
            self.assertEqual(len(missing), 1)
            returning = next(iter(missing))
            self.assertNotIn(returning, observations[12])
            self.assertIn(returning, observations[13])
            self.assertEqual(observations[13][returning]["FirstSeen"], original[returning]["FirstSeen"])
            # The scheduled gap repeats without creating another first discovery.
            self.assertNotIn(returning, observations[35])
            self.assertNotIn(returning, observations[36])
            self.assertEqual(observations[37][returning]["FirstSeen"], original[returning]["FirstSeen"])
            stable_fields = set(COLUMNS) - {"RSSI", "AccuracyMeters"}
            for snapshot in observations:
                for mac in snapshot.keys() & original.keys():
                    self.assertEqual({key: snapshot[mac][key] for key in stable_fields},
                                     {key: original[mac][key] for key in stable_fields})

    async def test_measurements_change_for_shared_and_local_addresses(self):
        samples = {}
        for _ in range(30):
            for record in await dummy.scan(0, node_id="pi-noise", radio="bluetooth"):
                samples.setdefault(record["MAC"], set()).add(record["RSSI"])
        self.assertEqual(len(samples), 13)
        self.assertTrue(all(len(values) >= 10 for values in samples.values()))

    async def test_stop_and_cancellation_do_not_advance_scenario(self):
        stop = asyncio.Event()
        task = asyncio.create_task(dummy.scan(1, stop, node_id="pi-stop", radio="wifi"))
        await asyncio.sleep(0)
        stop.set()
        self.assertEqual(await task, [])
        self.assertEqual(dummy._scan_numbers, {})
        task = asyncio.create_task(dummy.scan(1, node_id="pi-stop", radio="wifi"))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(dummy._scan_numbers, {})
        self.assertEqual(len(await dummy.scan(0, node_id="pi-stop", radio="wifi")), 8)

    async def test_radio_schedules_are_independent(self):
        for _ in range(7):
            wifi = await dummy.scan(0, node_id="pi-independent", radio="wifi")
        bluetooth = await dummy.scan(0, node_id="pi-independent", radio="bluetooth")
        self.assertEqual(len(wifi), 9)
        self.assertEqual(len(bluetooth), 12)


if __name__ == "__main__":
    unittest.main()
