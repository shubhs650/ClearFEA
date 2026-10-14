# SPDX-License-Identifier: AGPL-3.0-or-later
"""Command line: `python -m clearfea_worker [run|check]`."""

import argparse
import logging
import signal
import sys
import threading

from .api import ApiClient, ApiError
from .config import ConfigError, load_settings
from .jobs import HANDLERS
from .runner import run_forever, run_once
from .versions import calculix_version, gmsh_loads, gmsh_version


def check() -> int:
    """Prints solver versions and confirms Gmsh loads. Exit code 1 if anything is missing."""
    ok = True
    ccx = calculix_version()
    print(f"CalculiX: {ccx or 'not found (ccx is not on PATH)'}")
    ok &= ccx is not None
    print(f"Gmsh package: {gmsh_version() or 'not installed'}")
    loaded, detail = gmsh_loads()
    print(detail)
    ok &= loaded
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="clearfea_worker", description=__doc__)
    sub = parser.add_subparsers(dest="command")
    run = sub.add_parser("run", help="claim and run jobs (default)")
    run.add_argument("--once", action="store_true", help="claim at most one job, then exit")
    sub.add_parser("check", help="print solver versions and check that Gmsh loads")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.command == "check":
        return check()

    try:
        settings = load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2

    if getattr(args, "once", False):
        client = ApiClient(settings.api_url, settings.worker_token, settings.worker_id)
        try:
            run_once(client, settings, HANDLERS)
        except ApiError as error:
            print(error, file=sys.stderr)
            return 1
        return 0

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    run_forever(settings, stop=stop)
    return 0


if __name__ == "__main__":
    sys.exit(main())
