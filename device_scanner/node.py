"""Independent scan and heartbeat loops shared by dummy and Raspberry Pi nodes."""

import asyncio
from datetime import datetime, timezone
from functools import partial
import importlib
import json
import logging
import signal
import sys
from urllib.request import Request, urlopen


LOG = logging.getLogger(__name__)
HTTP_TIMEOUT = 3.0
SHUTDOWN_GRACE = 6.0
RADIOS = ("bluetooth", "wifi")


def load_scan(scanner, radio, node_id):
    if scanner == "dummy":
        from .scanners.dummy import scan
        return partial(scan, node_id=node_id, radio=radio)
    if scanner != "real":
        raise ValueError("scanner must be real or dummy")
    if sys.platform != "linux":
        raise RuntimeError("Real scans require Linux, BlueZ and NetworkManager.")
    try:
        return importlib.import_module(f"device_scanner.scanners.{radio}").scan
    except ImportError as exc:
        raise RuntimeError(
            f"Cannot load {radio}: install dependencies with "
            "python -m pip install -r requirements-pi.txt"
        ) from exc


def post_report(server_url, report):
    """Send a current report once; no disk queue or retry backlog."""
    payload = json.dumps(report, ensure_ascii=True, allow_nan=False).encode("utf-8")
    request = Request(
        server_url.rstrip("/") + "/api/reports", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urlopen(request, timeout=HTTP_TIMEOUT) as response:
        if not 200 <= response.status < 300:
            raise OSError(f"Server returned HTTP {response.status}")


async def send_report(server_url, report):
    try:
        await asyncio.to_thread(post_report, server_url, report)
    except Exception as exc:
        LOG.warning("%s %s upload failed (%s); next report will contain current data",
                    report["node_id"], report.get("radio", "heartbeat"), type(exc).__name__)


async def pause(stop_event, interval):
    try:
        await asyncio.wait_for(stop_event.wait(), interval)
    except TimeoutError:
        pass


async def heartbeat_loop(*, node_id, server_url, scanner, interval, stop_event):
    while not stop_event.is_set():
        await send_report(server_url, {"node_id": node_id, "scanner": scanner, "kind": "heartbeat"})
        await pause(stop_event, interval)


async def radio_loop(*, node_id, server_url, scanner, radio, interval, timeout,
                     stop_event, bluetooth_adapter=None, wifi_interface=None):
    scan = None
    while not stop_event.is_set():
        report = {"node_id": node_id, "scanner": scanner, "kind": "scan", "radio": radio}
        try:
            if scan is None:
                scan = load_scan(scanner, radio, node_id)
            options = {}
            if scanner == "real":
                options = ({"adapter": bluetooth_adapter} if radio == "bluetooth"
                           else {"interface": wifi_interface})
            # Bluetooth setup and teardown use bounded D-Bus calls in addition
            # to the radio window. Wi-Fi already bounds its complete scan.
            observations = await asyncio.wait_for(scan(timeout, stop_event, **options), timeout + 10)
            if not isinstance(observations, list):
                raise ValueError("Scanner returned an invalid observation list")
            report.update(status="success", observations=observations)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error = str(exc) or type(exc).__name__
            error = "".join(char if char.isprintable() else " " for char in error)[:500]
            report.update(status="error", error=error)
            LOG.warning("%s %s scan failed: %s", node_id, radio, error)
        if stop_event.is_set():
            break  # A stopped scan is a partial result, not a completed scan.
        report["observed_at"] = datetime.now(timezone.utc).isoformat()
        await send_report(server_url, report)
        await pause(stop_event, interval)


async def run_node(*, node_id, server_url, scanner, interval, timeout, radios,
                   bluetooth_adapter=None, wifi_interface=None, stop_event=None):
    """Run until stopped; each radio and heartbeat has its own async task."""
    stop_event = stop_event if stop_event is not None else asyncio.Event()
    if stop_event.is_set():
        return
    common = dict(node_id=node_id, server_url=server_url, scanner=scanner,
                  interval=interval, stop_event=stop_event)
    tasks = [asyncio.create_task(heartbeat_loop(**common), name="heartbeat")]
    tasks.extend(asyncio.create_task(radio_loop(
        **common, radio=radio, timeout=timeout,
        bluetooth_adapter=bluetooth_adapter, wifi_interface=wifi_interface,
    ), name=f"scan-{radio}") for radio in radios)
    LOG.info("Node %s started (%s; %s)", node_id, scanner, ", ".join(radios))
    try:
        await stop_event.wait()
    finally:
        stop_event.set()
        # Allow real scanners to release discovery sessions cooperatively;
        # cancel anything still running after the grace period.
        _, pending = await asyncio.wait(tasks, timeout=SHUTDOWN_GRACE)
        for task in pending:
            task.cancel()
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), SHUTDOWN_GRACE)
        except TimeoutError:
            LOG.warning("Node %s scan cleanup exceeded the shutdown deadline", node_id)


async def _run_with_signals(**options):
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    handlers = {}
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, stop_event.set)
            handlers[signum] = None
        except NotImplementedError:
            handlers[signum] = signal.signal(
                signum, lambda *_: loop.call_soon_threadsafe(stop_event.set),
            )
    try:
        await run_node(**options, stop_event=stop_event)
    finally:
        for signum, previous in handlers.items():
            if previous is None:
                loop.remove_signal_handler(signum)
            else:
                signal.signal(signum, previous)


def run(*, node_id, server_url, scanner, interval, timeout, radios,
        bluetooth_adapter=None, wifi_interface=None):
    try:
        asyncio.run(_run_with_signals(
            node_id=node_id, server_url=server_url, scanner=scanner, interval=interval,
            timeout=timeout, radios=radios, bluetooth_adapter=bluetooth_adapter,
            wifi_interface=wifi_interface,
        ))
    except KeyboardInterrupt:
        pass
    return 0
