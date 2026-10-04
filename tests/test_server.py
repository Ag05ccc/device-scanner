"""HTTP behavior tests, with no radio hardware or third-party dependencies."""

from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from device_scanner.server import MAX_BODY_BYTES, make_server
from device_scanner.wigle import new_record


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.server = make_server(port=0, offline_after=10, clock=lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_address[1])

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()

    def request(self, path, payload=None, raw=None):
        body = json.dumps(payload).encode() if payload is not None else raw
        request = Request(self.base + path, data=body,
                          headers={"Content-Type": "application/json"})
        try:
            response = urlopen(request, timeout=3)
        except HTTPError as exc:
            response = exc
        with response:
            data = response.read()
            return response.status, json.loads(data) if "json" in response.headers["Content-Type"] else data

    def heartbeat(self, **changes):
        return {"node_id": "node-1", "scanner": "dummy", "kind": "heartbeat", **changes}

    def scan(self, **changes):
        record = new_record("02:00:00:00:00:01", "Örnek",
                            "WIFI" if changes.get("radio") == "wifi" else "BLE")
        record["RSSI"] = -50
        report = self.heartbeat(kind="scan", radio="bluetooth", status="success",
                                observed_at="2026-10-03T12:00:00Z", observations=[record])
        return {**report, **changes}

    def test_heartbeat_registers_node_without_hiding_radio_waiting(self):
        self.assertEqual(self.request("/api/reports", self.heartbeat())[0], 200)
        node = self.request("/api/nodes")[1]["nodes"][0]
        self.assertEqual(node["node_id"], "node-1")
        self.assertTrue(node["online"])
        self.assertEqual(node["radios"]["bluetooth"]["status"], "waiting")
        self.assertTrue(node["last_seen"].endswith("Z"))

    def test_scan_error_retains_last_success_and_later_empty_scan_clears(self):
        report = self.scan()
        self.assertEqual(self.request("/api/reports", report)[0], 200)
        error = {key: value for key, value in report.items() if key != "observations"}
        error.update(status="error", error="Adapter unavailable")
        self.assertEqual(self.request("/api/reports", error)[0], 200)
        radio = self.request("/api/nodes")[1]["nodes"][0]["radios"]["bluetooth"]
        self.assertEqual(radio["status"], "error")
        self.assertEqual(radio["observations"], report["observations"])
        report["observations"] = []
        self.assertEqual(self.request("/api/reports", report)[0], 200)
        radio = self.request("/api/nodes")[1]["nodes"][0]["radios"]["bluetooth"]
        self.assertEqual(radio["observations"], [])
        self.assertIsNone(radio["error"])

    def test_offline_and_reconnect_use_receipt_monotonic_time(self):
        self.request("/api/reports", self.heartbeat())
        self.now += 10
        self.assertFalse(self.request("/api/nodes")[1]["nodes"][0]["online"])
        self.request("/api/reports", self.heartbeat(scanner="invalid"))
        self.assertFalse(self.request("/api/nodes")[1]["nodes"][0]["online"])
        self.request("/api/reports", self.heartbeat())
        node = self.request("/api/nodes")[1]["nodes"][0]
        self.assertTrue(node["online"])
        self.assertEqual(node["age_seconds"], 0)

    def test_invalid_reports_are_rejected_without_registering_nodes(self):
        bad_reports = [[], {}, self.heartbeat(node_id="bad node"),
                       self.heartbeat(node_id="-invalid"), self.heartbeat(node_id="_invalid"),
                       self.heartbeat(scanner=[]), self.heartbeat(kind="unknown")]
        for key, value in [("radio", []), ("status", "invalid"),
                           ("observed_at", "2026-10-03"),
                           ("observed_at", "2026-10-03T12:00:00+03:00"),
                           ("observations", [{"path": "x", "properties": []}]),
                           ("observations", [{"path": "x", "properties": {"RSSI": float("nan")}}])]:
            report = self.scan()
            report[key] = value
            bad_reports.append(report)
        for report in bad_reports:
            with self.subTest(report=report):
                self.assertEqual(self.request("/api/reports", report)[0], 400)
        self.assertEqual(self.request("/api/nodes")[1]["nodes"], [])

    def test_invalid_wigle_fields_and_duplicates_are_rejected(self):
        for changes in ({"Type": "WIFI"}, {"MAC": "invalid"}, {"Channel": 6},
                        {"RSSI": True}, {"RSSI": "-50"}, {"Frequency": 1.5},
                        {"FirstSeen": "2026-10-04T00:00:00Z"}, {"FirstSeen": "2026-02-30 00:00:00"},
                        {"CurrentLatitude": 91, "CurrentLongitude": 0}, {"CurrentLatitude": 1},
                        {"MfgrId": 65536}, {"RCOIs": "1234"}, {"extra": "old property"}):
            report = self.scan()
            report["observations"][0].update(changes)
            with self.subTest(changes=changes):
                self.assertEqual(self.request("/api/reports", report)[0], 400)
        report = self.scan()
        report["observations"] *= 2
        self.assertEqual(self.request("/api/reports", report)[0], 400)
        self.assertEqual(self.request("/api/nodes")[1]["nodes"], [])

    def test_invalid_radio_metadata_is_rejected(self):
        bad_metadata = [
            {"enabled_radios": "wifi"}, {"enabled_radios": ["wifi", "wifi"]},
            {"enabled_radios": ["zigbee"]}, {"enabled_radios": [[]]},
            {"expected_cycle_seconds": []}, {"expected_cycle_seconds": {"zigbee": 30}},
            *({"expected_cycle_seconds": {"wifi": value}}
              for value in (None, True, "20", 0, -1, 86401, 10 ** 400, float("inf"))),
        ]
        for metadata in bad_metadata:
            with self.subTest(metadata=metadata):
                self.assertEqual(self.request("/api/reports", self.heartbeat(**metadata))[0], 400)
        self.assertEqual(self.request("/api/nodes")[1]["nodes"], [])

    def test_shared_floor_assignment_defaults_validation_and_unassign(self):
        for node_id in ("pi-01", "pi-2", "pi-3", "pi-4"):
            self.request("/api/reports", self.heartbeat(node_id=node_id))
        nodes = self.request("/api/nodes")[1]["nodes"]
        self.assertEqual({node["node_id"]: node["floor"] for node in nodes},
                         {"pi-01": 1, "pi-2": 2, "pi-3": 3, "pi-4": None})
        self.assertEqual(self.request("/api/placements", {"node_id": "pi-01", "floor": 2})[0], 200)
        self.assertEqual(self.request("/api/placements")[1]["placements"]["pi-01"], 2)
        self.assertEqual(self.request("/api/nodes")[1]["nodes"][0]["floor"], 2)
        self.request("/api/placements", {"node_id": "pi-01", "floor": None})
        self.assertIsNone(self.request("/api/nodes")[1]["nodes"][0]["floor"])
        for floor in (True, 0, 4, 1.5, "2", {}):
            self.assertEqual(self.request("/api/placements", {"node_id": "pi-01", "floor": floor})[0], 400)
        for bad in ({}, {"node_id": "pi-01"}, {"node_id": "bad/path", "floor": 2}):
            self.assertEqual(self.request("/api/placements", bad)[0], 400)

    def test_floor_assignments_survive_restart_and_failed_write_preserves_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state" / "placements.json"
            self.server.placements.path = path
            self.request("/api/placements", {"node_id": "pi-01", "floor": None})
            self.request("/api/placements", {"node_id": "pi-02", "floor": 1})
            original = path.read_bytes()
            with patch("device_scanner.placements.os.replace", side_effect=OSError("read-only")):
                status, response = self.request("/api/placements", {"node_id": "pi-02", "floor": 3})
            self.assertEqual(status, 500)
            self.assertIn("previous assignment retained", response["error"])
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(self.request("/api/placements")[1]["placements"]["pi-02"], 1)
            self.assertEqual(list(path.parent.iterdir()), [path])
            with make_server(port=0, placement_path=path) as restarted:
                self.assertEqual(restarted.placement_snapshot()["placements"], {"pi-01": None, "pi-02": 1})
                self.assertNotEqual(restarted.session_started_at, self.server.session_started_at)
            path.write_text('{"pi-02": 9}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Invalid floor assignments"):
                make_server(port=0, placement_path=path)

    def test_malformed_or_oversize_json_is_rejected(self):
        for raw in (b"{", b"\xff", b'{"number":1e400}', b"[" * 2000 + b"]" * 2000):
            self.assertEqual(self.request("/api/reports", raw=raw)[0], 400)
        # The server rejects oversized requests from their headers, before
        # reading the body. Avoid racing an upload against that early close.
        connection = HTTPConnection("127.0.0.1", self.server.server_address[1], timeout=3)
        try:
            connection.request("POST", "/api/reports", headers={
                "Content-Type": "application/json", "Content-Length": str(MAX_BODY_BYTES + 1),
            })
            response = connection.getresponse()
            self.assertEqual(response.status, 413)
            response.read()
        finally:
            connection.close()

    def test_json_surrogate_property_can_be_returned_without_encoding_failure(self):
        report = self.scan()
        report["observations"][0]["SSID"] = "\ud800"
        self.assertEqual(self.request("/api/reports", report)[0], 200)
        status, data = self.request("/api/nodes")
        self.assertEqual(status, 200)
        observed = data["nodes"][0]["radios"]["bluetooth"]["observations"]
        self.assertEqual(observed, report["observations"])

    def test_multiple_agents_and_radios_remain_independent(self):
        reports = []
        for number in range(3):
            for radio in ("bluetooth", "wifi"):
                report = self.scan(node_id=f"node-{number}", radio=radio)
                reports.append(report)
        with ThreadPoolExecutor(max_workers=6) as pool:
            codes = list(pool.map(lambda report: self.request("/api/reports", report)[0], reports))
        self.assertEqual(codes, [200] * 6)
        nodes = self.request("/api/nodes")[1]["nodes"]
        self.assertEqual(len(nodes), 3)
        for node in nodes:
            self.assertEqual([radio["status"] for radio in node["radios"].values()], ["success", "success"])

    def test_dashboard_and_health(self):
        self.assertEqual(self.request("/api/health"), (200, {"status": "ok"}))
        status, html = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Device Scanner", html)
        self.assertIn(b'type="module"', html)
        self.assertIn(b"/static/js/app.js", html)
        self.assertNotIn(b"innerHTML", html)
        self.assertEqual(self.request("/missing")[0], 404)

    def test_frontend_assets_have_browser_compatible_types_and_no_source_exposure(self):
        for path, expected_type in [("/static/styles.css", "text/css"),
                                     ("/static/js/app.js", "text/javascript"),
                                     ("/static/js/building.js", "text/javascript"),
                                     ("/static/js/placement.js", "text/javascript"),
                                     ("/static/js/observations.js", "text/javascript")]:
            with self.subTest(path=path), urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), expected_type)
                self.assertTrue(response.read())
        for path in ("/static/../server.py", "/static/%2e%2e/server.py", "/server.py",
                     "/static/js/unknown.js", "/.git/config"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
