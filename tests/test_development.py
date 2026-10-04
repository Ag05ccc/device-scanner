"""Exercise the same independent processes that a user runs on PC/Pi."""

import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen

from device_scanner.wigle import COLUMNS, validate_record


ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class DevelopmentTests(unittest.TestCase):
    def setUp(self):
        self.processes = []
        self.files = []
        self.port = free_port()
        self.address = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        for handle in self.files:
            handle.close()

    def start(self, *arguments):
        output = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
        self.files.append(output)
        process = subprocess.Popen(
            [sys.executable, "-u", "-m", "device_scanner", *arguments],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
        )
        self.processes.append(process)
        return process, output

    def wait_for(self, predicate, message, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if predicate():
                    return
            except (URLError, OSError, ValueError):
                pass
            time.sleep(0.05)
        logs = []
        for handle in self.files:
            handle.seek(0)
            logs.append(handle.read())
        self.fail(message + "\n" + "\n".join(logs))

    def nodes(self):
        with urlopen(self.address + "/api/nodes", timeout=0.5) as response:
            return json.load(response)["nodes"]

    def healthy(self, count):
        nodes = self.nodes()
        return len(nodes) == count and all(
            node["online"] and all(node["radios"][radio]["status"] == "success"
                                    for radio in ("bluetooth", "wifi"))
            for node in nodes
        )

    @unittest.skipUnless(os.name == "posix", "process signal check uses POSIX")
    def test_dev_launches_independent_nodes_and_cleans_up(self):
        dev, output = self.start("dev", "--port", str(self.port), "--interval", "0.1")
        self.wait_for(lambda: self.healthy(3), "three dummy nodes never became ready")
        for node in self.nodes():
            for radio, scan in node["radios"].items():
                self.assertEqual(len(scan["observations"]), 1)
                record = scan["observations"][0]
                self.assertEqual(tuple(record), COLUMNS)
                validate_record(record, radio)
        output.seek(0)
        children = dict((name, int(pid)) for name, pid in
                        re.findall(r"^(server|pi-\d+): PID (\d+)$", output.read(), re.MULTILINE))
        self.assertEqual(set(children), {"server", "pi-01", "pi-02", "pi-03"})
        self.assertEqual(len(set(children.values())), 4)
        os.kill(children["pi-02"], signal.SIGTERM)
        self.wait_for(lambda: any(node["node_id"] == "pi-02" and not node["online"] for node in self.nodes()),
                      "stopped node was not marked offline", timeout=9)
        self.assertTrue(all(node["online"] for node in self.nodes() if node["node_id"] != "pi-02"))
        self.assertIsNone(dev.poll())
        dev.terminate()
        self.assertEqual(dev.wait(timeout=8), 0)
        for pid in children.values():
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        # No child remains bound to the application's port.
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", self.port))

    def test_node_recovers_after_server_restart(self):
        server, _ = self.start("server", "--port", str(self.port))
        node, _ = self.start("node", "--id", "pi-recovery", "--scanner", "dummy",
                             "--server", self.address, "--interval", "0.1")
        self.wait_for(lambda: self.healthy(1), "node did not report")
        before = self.nodes()[0]["last_seen"]
        server.terminate()
        server.wait(timeout=5)
        time.sleep(0.35)
        self.assertIsNone(node.poll())
        restarted, _ = self.start("server", "--port", str(self.port))
        self.wait_for(lambda: self.healthy(1) and self.nodes()[0]["last_seen"] != before,
                      "node did not recover when the server returned")
        self.assertIsNone(restarted.poll())

    def test_busy_dev_port_leaves_existing_server_running(self):
        server, _ = self.start("server", "--port", str(self.port))
        self.wait_for(lambda: self.nodes() == [], "server did not start")
        dev, _ = self.start("dev", "--port", str(self.port))
        self.assertNotEqual(dev.wait(timeout=5), 0)
        self.assertIsNone(server.poll())
        self.assertEqual(self.nodes(), [])


if __name__ == "__main__":
    unittest.main()
