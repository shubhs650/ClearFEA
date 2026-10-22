# SPDX-License-Identifier: AGPL-3.0-or-later
"""Compute manager settings, read from environment variables (M12.1, ADR-107)."""

import os
import re
import socket
from collections.abc import Mapping
from dataclasses import dataclass

from ..config import ConfigError, Settings, load_settings
from ..spec.jobs_schema import JobType


@dataclass(frozen=True)
class Lane:
    """One job at a time of these job types, in a container held to these limits."""

    name: str
    job_types: tuple[JobType, ...]
    #: Whole or fractional CPUs, used when ``cpuset`` is not given.
    cpus: float
    memory_bytes: int
    #: CPUs to pin the lane's containers to, in Docker's form ("0-5", "6"). None leaves them
    #: free to run on any CPU, held to ``cpus`` by the scheduler.
    cpuset: str | None = None


@dataclass(frozen=True)
class ManagerSettings:
    #: The API address, worker token and Access service token, as for a worker.
    worker: Settings
    #: This host's name; the lanes claim as ``<host>-<lane>``.
    host: str
    #: The worker image each job container runs.
    image: str
    lanes: tuple[Lane, ...]
    #: Docker network of the job containers: "bridge" (outbound only, no published ports) on
    #: the VPS, "host" where the API listens on the host's loopback (make dev on Linux).
    network: str = "bridge"
    docker_socket: str = "/var/run/docker.sock"
    #: Most processes and threads in one job container.
    pids_limit: int = 1024
    #: Size of the in-memory /tmp of a job container; the job's files go to its scratch volume.
    tmp_size: str = "256m"
    #: First pause between claims of an idle lane; it doubles while nothing is queued, up to
    #: ``idle_poll_max_seconds``.
    poll_seconds: float = 2.0
    idle_poll_max_seconds: float = 15.0
    #: A job container still running after this long is killed: above the 12-hour stop-limit
    #: ceiling, so it only catches a job that stopped answering its heartbeats.
    job_max_seconds: float = 13 * 3600.0
    #: A folder on the disk that holds the job containers' scratch volumes (Docker's data root,
    #: mounted into the manager), and the free space below which no job is claimed (ADR-108).
    #: None leaves the disk unchecked, as on a development machine.
    scratch_path: str | None = None
    scratch_min_free_bytes: int = 20 * 1024**3


#: Starting values from ADR-107 for the Contabo Cloud VPS 8 (8 vCPU, 24 GB); M12.6 measures them.
LIGHT_TYPES: tuple[JobType, ...] = ("noop", "import", "mesh", "report")
SOLVE_TYPES: tuple[JobType, ...] = ("solve",)
DEFAULT_LIGHT = Lane("light", LIGHT_TYPES, cpus=1.0, memory_bytes=4 * 1024**3)
DEFAULT_SOLVE = Lane("solve", SOLVE_TYPES, cpus=6.0, memory_bytes=17 * 1024**3)

_HOST_NAME = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_CPUSET = re.compile(r"^\d+(-\d+)?(,\d+(-\d+)?)*$")
_MEMORY = re.compile(r"^(\d+(?:\.\d+)?)\s*([kmg]?)i?b?$", re.IGNORECASE)
_UNITS = {"": 1, "k": 1024, "m": 1024**2, "g": 1024**3}


def parse_memory(name: str, raw: str) -> int:
    """Bytes from "17g", "4096m" or a plain number of bytes."""
    match = _MEMORY.match(raw.strip())
    if match is None or float(match.group(1)) <= 0:
        raise ConfigError(f"{name} must be an amount of memory such as 4g or 4096m, got {raw!r}.")
    return int(float(match.group(1)) * _UNITS[match.group(2).lower()])


def _positive(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number, got {raw!r}.") from None
    if value <= 0:
        raise ConfigError(f"{name} must be greater than zero, got {raw!r}.")
    return value


def _lane(env: Mapping[str, str], default: Lane) -> Lane:
    prefix = f"CLEARFEA_{default.name.upper()}"
    memory = env.get(f"{prefix}_MEMORY", "").strip()
    cpuset = env.get(f"{prefix}_CPUSET", "").strip() or None
    if cpuset is not None and not _CPUSET.match(cpuset):
        raise ConfigError(f"{prefix}_CPUSET must list CPUs such as 0-5 or 6, got {cpuset!r}.")
    return Lane(
        name=default.name,
        job_types=default.job_types,
        cpus=_positive(env, f"{prefix}_CPUS", default.cpus),
        memory_bytes=parse_memory(f"{prefix}_MEMORY", memory) if memory else default.memory_bytes,
        cpuset=cpuset,
    )


def load_manager_settings(env: Mapping[str, str] | None = None) -> ManagerSettings:
    env = os.environ if env is None else env
    worker = load_settings(env)
    host = env.get("CLEARFEA_HOST_NAME", "").strip() or socket.gethostname()
    if not _HOST_NAME.match(host):
        raise ConfigError(
            "CLEARFEA_HOST_NAME must be 1 to 64 letters, digits, dots, dashes or underscores, "
            f"got {host!r}."
        )
    network = env.get("CLEARFEA_JOB_NETWORK", "").strip() or "bridge"
    pids = _positive(env, "CLEARFEA_JOB_PIDS_LIMIT", 1024)
    return ManagerSettings(
        worker=worker,
        host=host,
        image=env.get("CLEARFEA_JOB_IMAGE", "").strip() or "clearfea-worker",
        lanes=(_lane(env, DEFAULT_SOLVE), _lane(env, DEFAULT_LIGHT)),
        network=network,
        docker_socket=env.get("CLEARFEA_DOCKER_SOCKET", "").strip() or "/var/run/docker.sock",
        pids_limit=int(pids),
        poll_seconds=worker.poll_seconds,
        idle_poll_max_seconds=_positive(env, "CLEARFEA_IDLE_POLL_MAX_SECONDS", 15.0),
        job_max_seconds=_positive(env, "CLEARFEA_JOB_MAX_SECONDS", 13 * 3600.0),
        scratch_path=env.get("CLEARFEA_SCRATCH_PATH", "").strip() or None,
        scratch_min_free_bytes=parse_memory("CLEARFEA_SCRATCH_MIN_FREE", min_free)
        if (min_free := env.get("CLEARFEA_SCRATCH_MIN_FREE", "").strip())
        else 20 * 1024**3,
    )
