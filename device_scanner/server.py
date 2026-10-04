"""Small, in-memory HTTP server for local development and a trusted LAN."""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import re
import signal
import threading
import time
from typing import Any, Callable
from urllib.parse import urlsplit

from .wigle import validate_record
from .monitoring import ObservationHistory
from .placements import Placements, validate_placement


MAX_BODY_BYTES = 1024 * 1024
NODE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
RADIOS = ("bluetooth", "wifi")
STATIC_DIR = Path(__file__).with_name("static")
# An explicit allowlist keeps application files outside the public web root.
STATIC_FILES = {"/": ("index.html", "text/html"),
                "/static/styles.css": ("styles.css", "text/css")}
for module in ("app", "api", "observations", "ui", "nodes", "results", "details", "charts", "export", "building", "placement", "entities", "overview", "devices"):
    STATIC_FILES[f"/static/js/{module}.js"] = (f"js/{module}.js", "text/javascript")


def _finite_json(value: Any, depth: int = 0) -> None:
    if depth > 20:
        raise ValueError("JSON is nested too deeply")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("JSON numbers must be finite")
    if isinstance(value, dict):
        for item in value.values():
            _finite_json(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _finite_json(item, depth + 1)


def _validate_report(report: Any) -> dict[str, Any]:
    _finite_json(report)
    if not isinstance(report, dict):
        raise ValueError("Report must be a JSON object")
    node_id = report.get("node_id")
    if not isinstance(node_id, str) or not NODE_ID.fullmatch(node_id):
        raise ValueError("node_id must start with a letter or digit and contain 1–64 letters, digits, underscores or hyphens")
    if report.get("scanner") not in ("dummy", "real"):
        raise ValueError("scanner must be dummy or real")
    if "enabled_radios" in report:
        enabled = report["enabled_radios"]
        if (not isinstance(enabled, list) or any(radio not in RADIOS for radio in enabled)
                or len(set(enabled)) != len(enabled)):
            raise ValueError("enabled_radios must be an array of unique radio names")
    if "expected_cycle_seconds" in report:
        cycles = report["expected_cycle_seconds"]
        if not isinstance(cycles, dict) or any(radio not in RADIOS for radio in cycles):
            raise ValueError("expected_cycle_seconds must be an object keyed by radio")
        if any(type(value) not in (int, float) or not 0 < value <= 86400
               for value in cycles.values()):
            raise ValueError("Expected cycles must contain positive finite seconds, at most 86400")
    if report.get("kind") == "heartbeat":
        return report
    if report.get("kind") != "scan":
        raise ValueError("kind must be heartbeat or scan")
    if report.get("radio") not in RADIOS:
        raise ValueError("radio must be bluetooth or wifi")
    timestamp = report.get("observed_at")
    if not isinstance(timestamp, str) or len(timestamp) > 64 or "T" not in timestamp:
        raise ValueError("observed_at must be an ISO 8601 UTC timestamp")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if parsed.utcoffset() != timedelta(0):
            raise ValueError
    except ValueError:
        raise ValueError("observed_at must be an ISO 8601 UTC timestamp") from None
    if report.get("status") == "error":
        error = report.get("error")
        if not isinstance(error, str) or not error or len(error) > 500:
            raise ValueError("error must contain 1–500 characters")
        if "observations" in report:
            raise ValueError("Error reports must not include observations")
    elif report.get("status") == "success":
        observations = report.get("observations")
        if not isinstance(observations, list):
            raise ValueError("observations must be an array")
        identities = set()
        for observation in observations:
            validate_record(observation, report["radio"])
            identity = (observation["Type"], observation["MAC"].upper())
            if identity in identities:
                raise ValueError("A scan must not repeat a Type/MAC observation")
            identities.add(identity)
    else:
        raise ValueError("status must be success or error")
    return report


def _waiting_radio() -> dict[str, Any]:
    return {"status": "waiting", "observations": [], "error": None,
            "observed_at": None, "received_at": None, "last_success_at": None,
            "last_error_at": None,
            "enabled": None, "expected_cycle_seconds": None,
            "_last_success_tick": None}


class ScannerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, host: str, port: int, offline_after: float,
                 clock: Callable[[], float], placement_path: Path | str | None = None) -> None:
        if not math.isfinite(offline_after) or offline_after <= 0:
            raise ValueError("offline_after must be a positive finite number")
        self.offline_after = offline_after
        self.clock = clock
        self._started_tick = clock()
        self._started_wall = datetime.now(timezone.utc)
        self.session_started_at = self._started_wall.isoformat(
            timespec="microseconds").replace("+00:00", "Z")
        self.nodes: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.history = ObservationHistory()
        self.placements = Placements(placement_path)
        self.assets = {url: (STATIC_DIR.joinpath(filename).read_bytes(), content_type)
                       for url, (filename, content_type) in STATIC_FILES.items()}
        super().__init__((host, port), _Handler)

    def _timestamp(self, tick: float) -> str:
        return (self._started_wall + timedelta(seconds=tick - self._started_tick)).isoformat(
            timespec="milliseconds").replace("+00:00", "Z")

    def accept_report(self, report: dict[str, Any]) -> None:
        with self.lock:
            now = self.clock()
            received_at = self._timestamp(now)
            node = self.nodes.setdefault(report["node_id"], {
                "node_id": report["node_id"],
                "radios": {radio: _waiting_radio() for radio in RADIOS},
            })
            if node.get("scanner") not in (None, report["scanner"]):
                # Reusing a Pi ID for real hardware must not relabel retained
                # demo measurements (or the reverse) under its new mode.
                node["radios"] = {radio: _waiting_radio() for radio in RADIOS}
                self.history.reset_node(report["node_id"])
            node.update(scanner=report["scanner"], last_seen=received_at,
                        _last_seen_tick=now)
            for name, radio in node["radios"].items():
                if "enabled_radios" in report:
                    radio["enabled"] = name in report["enabled_radios"]
                if name in report.get("expected_cycle_seconds", {}):
                    radio["expected_cycle_seconds"] = report["expected_cycle_seconds"][name]
            if report["kind"] == "scan":
                radio = node["radios"][report["radio"]]
                if radio["enabled"] is None:
                    radio["enabled"] = True
                radio.update(status=report["status"], observed_at=report["observed_at"],
                             received_at=received_at,
                             error=report["error"] if report["status"] == "error" else None)
                if report["status"] == "error":
                    radio["last_error_at"] = received_at
                if report["status"] == "success":
                    radio["observations"] = copy.deepcopy(report["observations"])
                    radio.update(last_success_at=received_at, _last_success_tick=now)
                    self.history.accept(report["node_id"], report["radio"],
                                        report["observations"], now, received_at,
                                        scanner=report["scanner"])

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            now = self.clock()
            self.history.prune(now)
            nodes = []
            for node_id in sorted(self.nodes):
                node = copy.deepcopy(self.nodes[node_id])
                age = max(0.0, now - node.pop("_last_seen_tick"))
                node.update(age_seconds=round(age, 3), online=age < self.offline_after,
                            floor=self.placements.floor(node_id))
                for name, radio in node["radios"].items():
                    tick = radio.pop("_last_success_tick")
                    success_age = max(0, now - tick) if tick is not None else None
                    radio["success_age_seconds"] = round(success_age, 3) if success_age is not None else None
                    threshold = max(30, 2 * (radio["expected_cycle_seconds"] or 0))
                    radio["freshness"] = (
                        "disabled" if radio["enabled"] is False else
                        "error" if radio["status"] == "error" else
                        "waiting" if success_age is None else
                        "fresh" if success_age < threshold else "stale")
                    radio["recent_observations"] = self.history.snapshot(node_id, name, now)
                nodes.append(node)
            return {"session_started_at": self.session_started_at, "nodes": nodes}

    def placement_snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {"placements": self.placements.snapshot(self.nodes)}

    def assign_floor(self, node_id: str, floor: int | None) -> None:
        with self.lock:
            self.placements.set(node_id, floor)


class _Handler(BaseHTTPRequestHandler):
    server: ScannerServer

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format: str, *args: Any) -> None:
        # Polls and successful node reports should not flood the terminal.
        pass

    def _send(self, status: int, data: Any, content_type: str = "application/json") -> None:
        body = data if isinstance(data, bytes) else json.dumps(
            data, ensure_ascii=True, allow_nan=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in self.server.assets:
            body, content_type = self.server.assets[path]
            self._send(200, body, content_type)
        elif path == "/api/health":
            self._send(200, {"status": "ok"})
        elif path == "/api/nodes":
            self._send(200, self.server.snapshot())
        elif path == "/api/placements":
            self._send(200, self.server.placement_snapshot())
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path not in ("/api/reports", "/api/placements"):
            self._send(404, {"error": "Not found"})
            return
        if self.headers.get("Transfer-Encoding"):
            self._send(400, {"error": "Transfer-Encoding is not supported"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if not lengths:
            self._send(411, {"error": "Content-Length is required"})
            return
        try:
            if len(lengths) != 1:
                raise ValueError
            length = int(lengths[0])
            if length < 0:
                raise ValueError
        except ValueError:
            self._send(400, {"error": "Invalid Content-Length"})
            return
        if length > MAX_BODY_BYTES:
            self._send(413, {"error": "Report exceeds 1 MiB"})
            return
        if self.headers.get_content_type() != "application/json":
            self._send(415, {"error": "Content-Type must be application/json"})
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete request body")
            value = json.loads(body)
            report = (_validate_report(value) if path == "/api/reports"
                      else validate_placement(value))
        except TimeoutError:
            self._send(408, {"error": "Request body timed out"})
            return
        except ConnectionResetError:
            self.close_connection = True
            return
        except (ValueError, UnicodeError, RecursionError) as exc:
            self._send(400, {"error": str(exc) or "Invalid JSON report"})
            return
        if path == "/api/placements":
            try:
                self.server.assign_floor(report["node_id"], report["floor"])
            except OSError:
                self._send(500, {"error": "Floor assignment could not be saved; previous assignment retained"})
                return
            self._send(200, self.server.placement_snapshot())
        else:
            self.server.accept_report(report)
            self._send(200, {"status": "ok"})


def make_server(host: str = "127.0.0.1", port: int = 8001,
                offline_after: float = 60, *,
                clock: Callable[[], float] = time.monotonic,
                placement_path: Path | str | None = None) -> ScannerServer:
    return ScannerServer(host, port, offline_after, clock, placement_path)


def run(*, host: str = "127.0.0.1", port: int = 8001,
        offline_after: float = 60,
        placements_file: Path | str = ".device-scanner/placements.json") -> None:
    with make_server(host, port, offline_after,
                     placement_path=placements_file) as server:
        previous_handlers = {}

        def stop(signum: int, frame: Any) -> None:
            threading.Thread(target=server.shutdown, daemon=True).start()

        if threading.current_thread() is threading.main_thread():
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous_handlers[signum] = signal.signal(signum, stop)
        bound_host, bound_port = server.server_address[:2]
        print(f"Server: http://{bound_host}:{bound_port}", flush=True)
        try:
            server.serve_forever(poll_interval=0.2)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
