"""Read measured dBm from Linux's scan cache; never initiate an extra scan."""

import asyncio
import re


def parse_signals(output):
    signals = {}
    mac = None
    frequency = None
    rssi = None

    def save():
        if mac is not None and frequency is not None and rssi is not None:
            signals[(mac, frequency)] = rssi

    for line in output.splitlines():
        match = re.match(r"BSS ([0-9a-fA-F:]{17})(?:\s|\(|$)", line)
        if match:
            save()
            mac, frequency, rssi = match[1].upper(), None, None
        elif match := re.match(r"\s*freq:\s*(\d+)\s*$", line):
            frequency = int(match[1])
        elif match := re.match(r"\s*signal:\s*(-?\d+(?:\.\d+)?) dBm\s*$", line):
            rssi = float(match[1])
    save()
    return signals


async def read_signals(interface):
    """Missing iw, permissions, or dBm support means an unknown RSSI."""
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            "iw", "dev", interface, "scan", "dump",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"},
        )
        output, _ = await asyncio.wait_for(process.communicate(), 2)
        return parse_signals(output.decode("utf-8", errors="replace")) if process.returncode == 0 else {}
    except (OSError, TimeoutError):
        return {}
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.communicate()
