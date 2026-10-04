"""Launch actual server/node processes; own only their lifecycle, not their logic."""

import logging
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent
LOG = logging.getLogger(__name__)


def stop_children(children):
    for _, child in children:
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 5
    for _, child in children:
        try:
            child.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def run(*, nodes=3, port=8001, interval=2.0):
    """One localhost server plus N independently stoppable dummy nodes."""
    # Fail before spawning anything when a different process already owns this port.
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(("127.0.0.1", port))

    children = []
    stopped = threading.Event()
    previous_handlers = {}
    for signum in (signal.SIGINT, signal.SIGTERM):
        previous_handlers[signum] = signal.signal(signum, lambda *_: stopped.set())

    def launch(label, arguments):
        child = subprocess.Popen(
            [sys.executable, "-u", "-m", "device_scanner", *arguments],
            cwd=ROOT, start_new_session=True,
        )
        children.append((label, child))
        print(f"{label}: PID {child.pid}", flush=True)
        return child

    try:
        server = launch("server", ["server", "--port", str(port),
                                   "--offline-after", str(max(6.0, interval * 3))])
        address = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 10
        while not stopped.is_set():
            if server.poll() is not None:
                raise OSError("Geliştirme sunucusu başlatılamadı.")
            try:
                with urlopen(address + "/api/health", timeout=0.5) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError, OSError):
                pass
            if time.monotonic() >= deadline:
                raise OSError("Geliştirme sunucusu zamanında yanıt vermedi.")
            stopped.wait(0.1)

        for number in range(1, nodes + 1):
            if stopped.is_set():
                break
            node_id = f"pi-{number:02}"
            launch(node_id, ["node", "--id", node_id, "--server", address,
                             "--scanner", "dummy", "--interval", str(interval)])

        if not stopped.is_set():
            print(f"\n{address} — {nodes} dummy node. Kapatmak için Ctrl+C.", flush=True)
        reported_exits = set()
        while not stopped.wait(0.25):
            if server.poll() is not None:
                LOG.error("Sunucu kapandı; geliştirme ortamı durduruluyor.")
                return 1
            for label, child in children[1:]:
                if child.poll() is not None and label not in reported_exits:
                    reported_exits.add(label)
                    LOG.warning("%s kapandı (kod %s); diğer node'lar çalışıyor.", label, child.returncode)
        return 0
    finally:
        stop_children(children)
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
