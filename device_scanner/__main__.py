"""Command-line entry points shared by a development PC and Raspberry Pis."""

import argparse
import logging
import math
import re
from urllib.parse import urlsplit


def positive_number(value):
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("pozitif bir sayı gerekli") from None
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("pozitif, sonlu bir sayı gerekli")
    return number


def positive_integer(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("pozitif bir tam sayı gerekli") from None
    if number <= 0:
        raise argparse.ArgumentTypeError("pozitif bir tam sayı gerekli")
    return number


def port_number(value):
    number = positive_integer(value)
    if number > 65535:
        raise argparse.ArgumentTypeError("port 1–65535 arasında olmalı")
    return number


def node_identifier(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", value):
        raise argparse.ArgumentTypeError("node kimliği 1–64 harf, rakam, _ veya - içermeli")
    return value


def server_address(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or port == 0 or any(ord(char) <= 32 for char in value)):
            raise ValueError
    except ValueError:
        raise argparse.ArgumentTypeError("http(s)://adres[:port] biçiminde sunucu adresi gerekli") from None
    return value.rstrip("/")


def radios(value):
    names = value.split(",")
    if any(name not in ("bluetooth", "wifi") for name in names) or len(set(names)) != len(names):
        raise argparse.ArgumentTypeError("bluetooth, wifi veya bluetooth,wifi kullanın")
    return names


def main(argv=None):
    parser = argparse.ArgumentParser(description="Device Scanner: sunucu, node ve yerel geliştirme ortamı")
    commands = parser.add_subparsers(dest="command", required=True)

    server_parser = commands.add_parser("server", help="web arayüzü ve rapor alıcısı")
    server_parser.add_argument("--host", default="127.0.0.1")
    server_parser.add_argument("--port", type=port_number, default=8001)
    server_parser.add_argument("--offline-after", type=positive_number, default=60.0, metavar="SECONDS")

    node_parser = commands.add_parser("node", help="bağımsız tarayıcı node")
    node_parser.add_argument("--id", dest="node_id", required=True, type=node_identifier)
    node_parser.add_argument("--server", dest="server_url", type=server_address, default="http://127.0.0.1:8001")
    node_parser.add_argument("--scanner", choices=("dummy", "real"), default="real")
    node_parser.add_argument("--interval", type=positive_number, default=5.0, metavar="SECONDS")
    node_parser.add_argument("--timeout", type=positive_number, default=10.0, metavar="SECONDS")
    node_parser.add_argument("--radios", type=radios, default=["bluetooth", "wifi"])
    node_parser.add_argument("--bluetooth-adapter", default=None, metavar="hci0")
    node_parser.add_argument("--wifi-interface", default=None, metavar="wlan0")

    dev_parser = commands.add_parser("dev", help="bir sunucu ve bağımsız dummy node'lar başlat")
    dev_parser.add_argument("--nodes", type=positive_integer, default=3)
    dev_parser.add_argument("--port", type=port_number, default=8001)
    dev_parser.add_argument("--interval", type=positive_number, default=2.0, metavar="SECONDS")

    args = vars(parser.parse_args(argv))
    command = args.pop("command")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    try:
        if command == "server":
            from .server import run
        elif command == "node":
            from .node import run
        else:
            from .dev import run
        result = run(**args)
        return result if isinstance(result, int) else 0
    except (OSError, ValueError, ImportError) as exc:
        parser.exit(1, f"Başlatılamadı: {exc}\n")
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
