"""Server receipt time, bounded history and honest per-radio freshness."""

import asyncio
import unittest
from unittest.mock import patch

from device_scanner import node
from device_scanner.monitoring import ObservationHistory, RETENTION_SECONDS
from device_scanner.server import make_server
from device_scanner.wigle import new_record


def record(number=1, kind="WIFI"):
    mac = f"02:00:00:{number >> 16 & 255:02X}:{number >> 8 & 255:02X}:{number & 255:02X}"
    result = new_record(mac, f"Device {number}", kind)
    result["RSSI"] = -50
    return result


class MonitoringTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.server = make_server(port=0, offline_after=10, clock=lambda: self.now)

    def tearDown(self):
        self.server.server_close()

    def heartbeat(self, node_id="pi-1", **metadata):
        self.server.accept_report({"node_id": node_id, "scanner": "dummy",
                                   "kind": "heartbeat", **metadata})

    def scan(self, records=None, *, node_id="pi-1", radio="wifi", error=None,
             scanner="dummy"):
        report = {"node_id": node_id, "scanner": scanner, "kind": "scan",
                  "radio": radio, "observed_at": "2026-10-01T00:00:00Z"}
        if error:
            report.update(status="error", error=error)
        else:
            report.update(status="success", observations=records if records is not None else [record()])
        self.server.accept_report(report)

    def radio(self, node_id="pi-1", radio="wifi"):
        return next(node for node in self.server.snapshot()["nodes"] if node["node_id"] == node_id)["radios"][radio]

    def test_heartbeat_online_does_not_refresh_old_success_or_disabled_radio(self):
        self.heartbeat(enabled_radios=["wifi"], expected_cycle_seconds={"wifi": 20})
        self.assertEqual(self.radio()["freshness"], "waiting")
        self.assertEqual(self.radio(radio="bluetooth")["freshness"], "disabled")
        self.scan()
        success_at = self.radio()["last_success_at"]
        self.now += 39
        self.heartbeat()
        self.assertTrue(self.server.snapshot()["nodes"][0]["online"])
        self.assertEqual(self.radio()["freshness"], "fresh")
        self.now += 1
        self.assertEqual(self.radio()["freshness"], "stale")
        self.assertEqual(self.radio()["success_age_seconds"], 40)
        self.assertEqual(self.radio()["last_success_at"], success_at)

    def test_error_keeps_success_age_and_history_without_counting_a_miss(self):
        self.scan()
        first = self.radio()
        self.now += 20
        self.scan(error="Adapter unavailable")
        failed = self.radio()
        self.assertEqual(failed["freshness"], "error")
        self.assertEqual(failed["success_age_seconds"], 20)
        self.assertEqual(failed["last_success_at"], first["last_success_at"])
        self.assertNotEqual(failed["last_error_at"], first["last_error_at"])
        self.assertEqual(failed["observations"], first["observations"])
        self.assertEqual(failed["recent_observations"][0]["missing_scans"], 0)
        self.scan([])
        cleared = self.radio()
        self.assertEqual(cleared["observations"], [])
        self.assertEqual(cleared["freshness"], "fresh")
        self.assertFalse(cleared["recent_observations"][0]["present"])
        self.assertEqual(cleared["recent_observations"][0]["missing_scans"], 1)
        self.now += 1
        self.scan([])
        self.assertEqual(self.radio()["recent_observations"][0]["missing_scans"], 2)
        self.scan()
        self.assertEqual(self.radio()["recent_observations"][0]["missing_scans"], 0)

    def test_old_nodes_infer_enabled_radios_without_claiming_disabled_or_fresh(self):
        self.heartbeat()
        self.assertIsNone(self.radio()["enabled"])
        self.assertIsNone(self.radio()["success_age_seconds"])
        self.scan()
        self.assertTrue(self.radio()["enabled"])
        self.assertIsNone(self.radio(radio="bluetooth")["enabled"])
        self.now += 30
        self.assertEqual(self.radio()["freshness"], "stale")

    def test_scan_rate_counts_success_intervals_not_heartbeats_polls_or_devices(self):
        self.heartbeat(enabled_radios=["wifi"], expected_cycle_seconds={"wifi": 90})
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.assertEqual(self.radio()["scan_rate_samples"], 0)
        self.assertIsNone(self.radio()["scan_rate_window_seconds"])
        self.scan([record(number) for number in range(50)])
        self.assertIsNone(self.radio()["scan_rate_hz"])
        # Two complete empty scans still represent two successful completions.
        self.scan([])  # A duplicate clock tick cannot create a zero interval.
        self.assertEqual(self.radio()["scan_rate_samples"], 0)
        self.now += 2
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], .5)
        self.assertEqual(self.radio()["scan_rate_window_seconds"], 2)
        self.assertEqual(self.radio()["scan_rate_samples"], 1)
        self.now += 1
        self.heartbeat()
        for _ in range(5):
            self.assertEqual(self.radio()["scan_rate_hz"], .5)
            self.assertEqual(self.radio()["scan_rate_samples"], 1)
        self.now += 1
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], .5)
        self.assertEqual(self.radio()["scan_rate_samples"], 2)
        self.assertEqual(self.radio()["scan_rate_window_seconds"], 4)
        self.assertNotIn("_scan_ticks", self.radio())

    def test_scan_rate_is_independent_for_each_radio_and_pi(self):
        self.scan([])
        self.scan([], radio="bluetooth")
        self.scan([], node_id="pi-2")
        self.now += .25
        self.scan([])
        self.now += .25
        self.scan([], radio="bluetooth")
        self.now += .5
        self.scan([], node_id="pi-2")
        self.assertEqual(self.radio()["scan_rate_hz"], 4)
        self.assertEqual(self.radio(radio="bluetooth")["scan_rate_hz"], 2)
        self.assertEqual(self.radio("pi-2")["scan_rate_hz"], 1)

    def test_scan_rate_suppresses_overdue_error_and_offline_without_inventing_zero(self):
        self.scan([])
        self.now += 1
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], 1)
        self.now += 2
        self.heartbeat()
        self.assertEqual(self.radio()["scan_rate_hz"], 1)
        self.now += .01
        self.assertEqual(self.radio()["freshness"], "fresh")
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.assertEqual(self.radio()["scan_rate_samples"], 1)
        self.assertEqual(self.radio()["scan_rate_window_seconds"], 1)
        self.scan(error="No adapter")
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.assertEqual(self.radio()["scan_rate_samples"], 1)
        self.now += .99
        self.scan([])
        # Recovery includes the actual missing time; no invented error samples.
        self.assertEqual(self.radio()["scan_rate_hz"], .5)
        self.assertEqual(self.radio()["scan_rate_samples"], 2)
        self.assertEqual(self.radio()["scan_rate_window_seconds"], 4)
        self.now += 10
        self.assertFalse(self.server.snapshot()["nodes"][0]["online"])
        self.assertIsNone(self.radio()["scan_rate_hz"])

    def test_scan_rate_stale_radio_remains_unavailable_despite_live_heartbeat(self):
        self.scan([])
        self.now += 20
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], .05)
        self.now += 30
        self.heartbeat()
        self.assertTrue(self.server.snapshot()["nodes"][0]["online"])
        self.assertEqual(self.radio()["freshness"], "stale")
        # The sample-derived overdue threshold is 40 s, so freshness alone gates this.
        self.assertIsNone(self.radio()["scan_rate_hz"])

    def test_scan_rate_resets_after_disable_reenable_and_scanner_mode_change(self):
        self.heartbeat(enabled_radios=["wifi"])
        self.scan([])
        self.now += 1
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], 1)
        self.heartbeat(enabled_radios=[])
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.assertEqual(self.radio()["scan_rate_samples"], 0)
        self.heartbeat(enabled_radios=["wifi"])
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.now += 1
        self.scan([])
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.now += 2
        self.scan([])
        self.assertEqual(self.radio()["scan_rate_hz"], .5)
        self.heartbeat(scanner="real", enabled_radios=["wifi"])
        self.assertIsNone(self.radio()["scan_rate_hz"])
        self.assertEqual(self.radio()["scan_rate_samples"], 0)
        self.scan([], scanner="real")
        self.now += 4
        self.scan([], scanner="real")
        self.assertEqual(self.radio()["scan_rate_hz"], .25)
        self.assertEqual(self.radio()["scan_rate_samples"], 1)

    def test_scan_rate_uses_at_most_ten_recent_intervals(self):
        self.scan([])
        self.now += 100
        self.scan([])
        for _ in range(10):
            self.now += .5
            self.scan([])
        rate = self.radio()
        self.assertEqual(rate["scan_rate_samples"], 10)
        self.assertEqual(rate["scan_rate_window_seconds"], 5)
        self.assertEqual(rate["scan_rate_hz"], 2)
        self.assertEqual(len(self.server.nodes["pi-1"]["radios"]["wifi"]["_scan_ticks"]), 11)

    def test_global_baseline_new_identity_and_repeated_source_are_consistent(self):
        self.scan([record(1)])
        self.assertFalse(self.radio()["recent_observations"][0]["is_new"])
        first_seen = self.radio()["recent_observations"][0]["first_seen_at"]
        self.now += 1
        self.scan([record(1), record(2)])
        self.now += 1
        self.scan([record(1), record(2), record(3)], node_id="pi-2")
        pi2 = {entry["record"]["MAC"]: entry for entry in self.radio("pi-2")["recent_observations"]}
        self.assertEqual(pi2[record(1)["MAC"]]["first_seen_at"], first_seen)
        self.assertFalse(pi2[record(1)["MAC"]]["is_new"])
        self.assertTrue(pi2[record(2)["MAC"]]["is_new"])
        self.assertFalse(pi2[record(3)["MAC"]]["is_new"])
        # A second client/reload receives exactly the same server-computed flags.
        self.assertEqual(self.server.snapshot(), self.server.snapshot())
        self.now += 599
        self.assertFalse(next(entry for entry in self.radio()["recent_observations"]
                              if entry["record"]["MAC"] == record(2)["MAC"])["is_new"])

    def test_bt_and_ble_share_identity_but_wifi_stays_separate(self):
        self.scan([], radio="bluetooth")
        self.scan([record(1, "BT")], radio="bluetooth")
        bt = self.radio(radio="bluetooth")["recent_observations"][0]
        self.now += 1
        self.scan([record(1, "BLE")], radio="bluetooth", node_id="pi-2")
        ble = self.radio("pi-2", "bluetooth")["recent_observations"][0]
        self.assertEqual(bt["first_seen_at"], ble["first_seen_at"])
        self.assertTrue(ble["is_new"])
        self.scan([record(1)])
        self.assertFalse(self.radio()["recent_observations"][0]["is_new"])

    def test_scanner_mode_change_discards_old_samples_without_touching_other_pis(self):
        self.heartbeat(enabled_radios=["wifi", "bluetooth"],
                       expected_cycle_seconds={"wifi": 20, "bluetooth": 20})
        self.scan([record(1)])
        self.scan([record(1, "BLE")], radio="bluetooth")
        self.scan([record(1)], node_id="pi-2")
        self.scan(error="Demo scan failed")
        self.server.assign_floor("pi-1", 3)
        other = self.radio("pi-2")
        dummy_first_seen = self.radio()["recent_observations"][0]["first_seen_at"]
        self.now += 1
        self.heartbeat(scanner="real", enabled_radios=["wifi"],
                       expected_cycle_seconds={"wifi": 15})
        node_snapshot = self.server.snapshot()["nodes"][0]
        self.assertEqual(node_snapshot["scanner"], "real")
        self.assertEqual(node_snapshot["floor"], 3)
        self.assertEqual(self.radio()["freshness"], "waiting")
        self.assertEqual(self.radio(radio="bluetooth")["freshness"], "disabled")
        for radio in node_snapshot["radios"].values():
            self.assertEqual(radio["observations"], [])
            self.assertEqual(radio["recent_observations"], [])
            self.assertIsNone(radio["last_success_at"])
            self.assertIsNone(radio["last_error_at"])
        self.assertEqual(self.radio()["expected_cycle_seconds"], 15)
        self.assertIsNone(self.radio(radio="bluetooth")["expected_cycle_seconds"])
        self.assertEqual(self.radio("pi-2")["observations"], other["observations"])
        self.assertEqual(self.radio("pi-2")["recent_observations"][0]["first_seen_at"],
                         dummy_first_seen)
        real_record = record(1)
        real_record.update(SSID="Real access point", RSSI=-72)
        self.scan([real_record], scanner="real")
        current = self.radio()
        self.assertEqual(current["observations"], [real_record])
        self.assertEqual(len(current["recent_observations"]), 1)
        self.assertEqual(current["recent_observations"][0]["record"], real_record)
        self.assertNotEqual(current["recent_observations"][0]["first_seen_at"], dummy_first_seen)
        self.assertFalse(current["recent_observations"][0]["is_new"])
        self.assertEqual(self.radio("pi-2")["observations"], other["observations"])

    def test_mode_change_on_scan_resets_both_radios_and_same_mode_first_seen_is_shared(self):
        self.scan([record(1)], scanner="real")
        self.scan([record(1, "BLE")], radio="bluetooth", scanner="real")
        real_first_seen = self.radio()["recent_observations"][0]["first_seen_at"]
        self.now += 1
        self.scan([record(1)], node_id="pi-2", scanner="real")
        self.assertEqual(self.radio("pi-2")["recent_observations"][0]["first_seen_at"],
                         real_first_seen)
        dummy_record = record(2)
        self.scan([dummy_record], scanner="dummy")
        self.assertEqual(self.radio()["observations"], [dummy_record])
        self.assertEqual(self.radio(radio="bluetooth")["recent_observations"], [])
        self.assertEqual(self.radio(radio="bluetooth")["freshness"], "waiting")
        self.assertIsNone(self.radio(radio="bluetooth")["enabled"])
        self.assertFalse(self.radio()["recent_observations"][0]["is_new"])
        self.assertEqual(self.radio("pi-2")["recent_observations"][0]["first_seen_at"],
                         real_first_seen)

    def test_history_expires_and_payload_and_snapshots_are_isolated(self):
        sent = record()
        self.scan([sent])
        original = self.radio()
        sent["SSID"] = "Changed sender"
        snapshot = self.radio()
        snapshot["recent_observations"][0]["record"]["SSID"] = "Changed client"
        snapshot["observations"][0]["SSID"] = "Changed client"
        self.assertEqual(self.radio(), original)
        self.now += RETENTION_SECONDS
        self.assertEqual(self.radio()["recent_observations"], [])
        self.scan([record()])
        self.assertEqual(self.radio()["recent_observations"][0]["first_seen_at"],
                         original["recent_observations"][0]["first_seen_at"])
        self.assertFalse(self.radio()["recent_observations"][0]["is_new"])

    def test_global_history_limit_evicts_oldest_across_radios_and_nodes(self):
        history = ObservationHistory(limit=3)
        history.accept("pi-1", "wifi", [record(1), record(2)], 0, "first")
        history.accept("pi-2", "bluetooth", [record(1, "BT")], 1, "second")
        history.accept("pi-1", "wifi", [record(2)], 2, "third")
        history.accept("pi-3", "wifi", [record(3)], 3, "fourth")
        self.assertEqual(len(history.entries), 3)
        self.assertEqual(len(history.identities), 3)
        self.assertEqual([entry["record"]["MAC"] for entry in history.snapshot("pi-1", "wifi", 3)],
                         [record(2)["MAC"]])
        self.assertEqual(len(history.snapshot("pi-2", "bluetooth", 3)), 1)
        history.prune(RETENTION_SECONDS + 3)
        self.assertEqual(len(history.entries), 0)

    def test_default_history_bound_is_ten_thousand_source_records(self):
        history = ObservationHistory()
        history.accept("pi-1", "wifi", [record(number) for number in range(10_001)],
                       0, "2026-10-04T00:00:00Z")
        self.assertEqual(len(history.entries), 10_000)
        self.assertEqual(len(history.identities), 10_000)
        self.assertNotIn(("wifi", record(0)["MAC"]), history.sources[("pi-1", "wifi")])


class HeartbeatMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_run_node_declares_only_enabled_radio_and_complete_cycle(self):
        stop = asyncio.Event()
        reports = []

        async def capture(server_url, report):
            reports.append(report)
            stop.set()

        with patch.object(node, "send_report", side_effect=capture):
            await node.run_node(node_id="pi-1", server_url="http://unused", scanner="dummy",
                                interval=5, timeout=15, radios=("wifi",), stop_event=stop)
        self.assertEqual(reports[0]["enabled_radios"], ["wifi"])
        self.assertEqual(reports[0]["expected_cycle_seconds"], {"wifi": 20})


if __name__ == "__main__":
    unittest.main()
