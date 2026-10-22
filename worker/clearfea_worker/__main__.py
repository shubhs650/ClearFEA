# SPDX-License-Identifier: AGPL-3.0-or-later
"""Command line: `python -m clearfea_worker [run|check|software|job|manager]`."""

import argparse
import logging
import os
import signal
import sys
import threading

from .api import ApiClient, ApiError
from .config import ConfigError, load_settings
from .jobs import HANDLERS
from .runner import run_forever, run_job, run_once
from .versions import calculix_version, gmsh_loads, gmsh_version, worker_software


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


def run_claimed_job() -> int:
    """Runs the one job the compute manager claimed and passed in CLEARFEA_JOB (M12.1): the
    container's whole life. Exit code 0 once the outcome is reported, 1 when it could not be."""
    from .manager.containers import JOB_VARIABLE, decode_job

    try:
        settings = load_settings()
        job = decode_job(os.environ[JOB_VARIABLE])
    except (ConfigError, KeyError, ValueError) as error:
        print(f"No job to run: {error}", file=sys.stderr)
        return 2
    access = None
    if settings.access_client_id and settings.access_client_secret:
        access = (settings.access_client_id, settings.access_client_secret)
    client = ApiClient(settings.api_url, settings.worker_token, settings.worker_id, access=access)
    logging.getLogger(__name__).info("Running job %s (%s)", job.id, job.type)
    try:
        status = run_job(client, job, HANDLERS, settings.heartbeat_seconds)
    except ApiError as error:
        print(error, file=sys.stderr)
        return 1
    logging.getLogger(__name__).info("Job %s finished: %s", job.id, status)
    return 0


def run_manager() -> int:
    """The compute manager (M12.1, ADR-107) until SIGTERM or SIGINT."""
    from .manager.config import load_manager_settings
    from .manager.docker import DockerClient, DockerError
    from .manager.manager import Manager

    try:
        settings = load_manager_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        Manager(settings, DockerClient(settings.docker_socket)).run(stop)
    except DockerError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="clearfea_worker", description=__doc__)
    sub = parser.add_subparsers(dest="command")
    run = sub.add_parser("run", help="claim and run jobs (default)")
    run.add_argument("--once", action="store_true", help="claim at most one job, then exit")
    sub.add_parser("check", help="print solver versions and check that Gmsh loads")
    sub.add_parser("software", help="print the versions a claim reports, as JSON")
    sub.add_parser("job", help="run the one job in CLEARFEA_JOB (a compute manager's container)")
    sub.add_parser("manager", help="run the compute manager: one container per job (ADR-107)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.command == "check":
        return check()
    if args.command == "software":
        print(worker_software().model_dump_json(by_alias=True))
        return 0
    if args.command == "job":
        return run_claimed_job()
    if args.command == "manager":
        return run_manager()

    try:
        settings = load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 2

    if getattr(args, "once", False):
        client = ApiClient(
            settings.api_url,
            settings.worker_token,
            settings.worker_id,
            machine_size=settings.machine_size,
        )
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
