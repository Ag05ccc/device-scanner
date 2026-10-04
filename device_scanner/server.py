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


MAX_BODY_BYTES = 1024 * 1024
NODE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
RADIOS = ("bluetooth", "wifi")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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
        for observation in observations:
            if not isinstance(observation, dict):
                raise ValueError("Each observation must be an object")
            path = observation.get("path")
            if not isinstance(path, str) or not path:
                raise ValueError("Each observation needs a nonempty path")
            if not isinstance(observation.get("properties"), dict):
                raise ValueError("Each observation needs a properties object")
    else:
        raise ValueError("status must be success or error")
    return report


def _waiting_radio() -> dict[str, Any]:
    return {"status": "waiting", "observations": [], "error": None,
            "observed_at": None, "received_at": None}


class ScannerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, host: str, port: int, offline_after: float,
                 clock: Callable[[], float]) -> None:
        if not math.isfinite(offline_after) or offline_after <= 0:
            raise ValueError("offline_after must be a positive finite number")
        self.offline_after = offline_after
        self.clock = clock
        self.nodes: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.dashboard = Path(__file__).with_name("dashboard.html").read_bytes()
        super().__init__((host, port), _Handler)

    def accept_report(self, report: dict[str, Any]) -> None:
        with self.lock:
            received_at = _utc_now()
            node = self.nodes.setdefault(report["node_id"], {
                "node_id": report["node_id"],
                "radios": {radio: _waiting_radio() for radio in RADIOS},
            })
            node.update(scanner=report["scanner"], last_seen=received_at,
                        _last_seen_tick=self.clock())
            if report["kind"] == "scan":
                radio = node["radios"][report["radio"]]
                radio.update(status=report["status"], observed_at=report["observed_at"],
                             received_at=received_at,
                             error=report["error"] if report["status"] == "error" else None)
                if report["status"] == "success":
                    radio["observations"] = report["observations"]

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            now = self.clock()
            nodes = []
            for node_id in sorted(self.nodes):
                node = copy.deepcopy(self.nodes[node_id])
                age = max(0.0, now - node.pop("_last_seen_tick"))
                node.update(age_seconds=round(age, 3), online=age < self.offline_after)
                nodes.append(node)
            return {"nodes": nodes}


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
        if path == "/":
            self._send(200, self.server.dashboard, "text/html")
        elif path == "/api/health":
            self._send(200, {"status": "ok"})
        elif path == "/api/nodes":
            self._send(200, self.server.snapshot())
        else:
            self._send(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/reports":
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
            report = _validate_report(json.loads(body))
        except TimeoutError:
            self._send(408, {"error": "Request body timed out"})
            return
        except ConnectionResetError:
            self.close_connection = True
            return
        except (ValueError, UnicodeError, RecursionError) as exc:
            self._send(400, {"error": str(exc) or "Invalid JSON report"})
            return
        self.server.accept_report(report)
        self._send(200, {"status": "ok"})


def make_server(host: str = "127.0.0.1", port: int = 8001,
                offline_after: float = 60, *,
                clock: Callable[[], float] = time.monotonic) -> ScannerServer:
    return ScannerServer(host, port, offline_after, clock)


def run(*, host: str = "127.0.0.1", port: int = 8001,
        offline_after: float = 60) -> None:
    with make_server(host, port, offline_after) as server:
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
