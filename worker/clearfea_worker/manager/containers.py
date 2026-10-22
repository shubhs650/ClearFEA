# SPDX-License-Identifier: AGPL-3.0-or-later
"""What a job container is: its hardened configuration, its labels and how the claimed job
reaches it (M12.1, ADR-107 item 3). Pure functions, so the hardening is tested without Docker."""

import base64
import gzip
import re
from datetime import datetime
from typing import Any

from ..api import ClaimedJob
from .config import Lane, ManagerSettings

#: The variable that carries the claimed job into its container, as gzip-compressed JSON in
#: base64. One environment string may be up to 128 KiB on Linux; a job is a few kilobytes.
JOB_VARIABLE = "CLEARFEA_JOB"
MAX_JOB_VARIABLE_CHARS = 128 * 1024 - len(JOB_VARIABLE) - 2

#: Labels on every job container and scratch volume. A manager finds its own containers by
#: its host label after a restart.
HOST_LABEL = "clearfea.manager.host"
LANE_LABEL = "clearfea.lane"
JOB_LABEL = "clearfea.job"
JOB_TYPE_LABEL = "clearfea.job.type"

#: The worker image's own user (worker/Dockerfile), and where each job container's scratch
#: volume is mounted; the image creates /scratch owned by that user, which Docker copies to a
#: new volume.
JOB_USER = "10001:10001"
SCRATCH = "/scratch"


class JobTooLarge(Exception):
    """The claimed job does not fit in its container's environment."""


def encode_job(job: ClaimedJob) -> str:
    raw = job.model_dump_json(by_alias=True, exclude_unset=True).encode()
    encoded = base64.b64encode(gzip.compress(raw, mtime=0)).decode()
    if len(encoded) > MAX_JOB_VARIABLE_CHARS:
        raise JobTooLarge(
            f"Job {job.id} is {len(encoded)} characters encoded, more than one environment "
            f"variable holds ({MAX_JOB_VARIABLE_CHARS})."
        )
    return encoded


def decode_job(encoded: str) -> ClaimedJob:
    return ClaimedJob.model_validate_json(gzip.decompress(base64.b64decode(encoded)))


def resource_name(job_id: str) -> str:
    """The container's and its scratch volume's name: Docker allows [a-zA-Z0-9_.-] after the
    first character."""
    return "clearfea-job-" + re.sub(r"[^a-zA-Z0-9_.-]", "-", job_id)


def worker_id(settings: ManagerSettings, lane: Lane) -> str:
    """The id a lane claims with, and its containers report as. One per lane, since a claim
    fails the jobs the claiming worker id still holds (M8.4)."""
    return f"{settings.host}-{lane.name}"


def labels(settings: ManagerSettings, lane: Lane, job: ClaimedJob) -> dict[str, str]:
    return {
        HOST_LABEL: settings.host,
        LANE_LABEL: lane.name,
        JOB_LABEL: job.id,
        JOB_TYPE_LABEL: job.type,
    }


def container_spec(
    settings: ManagerSettings,
    lane: Lane,
    job: ClaimedJob,
    image_id: str,
    host_cpus: int,
) -> dict[str, Any]:
    """The Engine API body that creates the job's container: the worker image running
    `python -m clearfea_worker job` for this one job, as a non-root user with no capabilities, a
    read-only root file system, its own scratch volume, hard memory and process limits, no swap,
    its lane's CPUs and outbound network only (ADR-107 item 3)."""
    worker = settings.worker
    env = {
        "CLEARFEA_API_URL": worker.api_url,
        "CLEARFEA_WORKER_TOKEN": worker.worker_token,
        "CLEARFEA_WORKER_ID": worker_id(settings, lane),
        "CLEARFEA_HEARTBEAT_SECONDS": str(worker.heartbeat_seconds),
        JOB_VARIABLE: encode_job(job),
        # Job files, raw output among them, go to the scratch volume, not to memory.
        "TMPDIR": SCRATCH,
        "HOME": SCRATCH,
    }
    if worker.access_client_id and worker.access_client_secret:
        env["CLEARFEA_ACCESS_CLIENT_ID"] = worker.access_client_id
        env["CLEARFEA_ACCESS_CLIENT_SECRET"] = worker.access_client_secret
    host_config: dict[str, Any] = {
        "Memory": lane.memory_bytes,
        # Equal to Memory: no swap, so a job over its lane's memory is stopped, not slowed.
        "MemorySwap": lane.memory_bytes,
        "PidsLimit": settings.pids_limit,
        "ReadonlyRootfs": True,
        "CapDrop": ["ALL"],
        "SecurityOpt": ["no-new-privileges:true"],
        "Tmpfs": {"/tmp": f"rw,nosuid,nodev,size={settings.tmp_size}"},
        "Mounts": [
            {"Type": "volume", "Source": resource_name(job.id), "Target": SCRATCH},
        ],
        "NetworkMode": settings.network,
        # Reaps the solver's and LibreOffice's child processes, and passes signals on.
        "Init": True,
        "RestartPolicy": {"Name": "no"},
        "LogConfig": {"Type": "json-file", "Config": {"max-size": "10m", "max-file": "2"}},
    }
    if lane.cpuset is not None:
        host_config["CpusetCpus"] = lane.cpuset
    else:
        # Docker refuses more CPUs than the host has, which a small development machine may.
        host_config["NanoCpus"] = int(min(lane.cpus, host_cpus) * 1e9)
    if settings.network != "host":
        # Docker Desktop's name for the host, where `make dev`'s API listens.
        host_config["ExtraHosts"] = ["host.docker.internal:host-gateway"]
    return {
        "Image": image_id,
        "Cmd": ["job"],
        "User": JOB_USER,
        "WorkingDir": SCRATCH,
        "Env": [f"{name}={value}" for name, value in env.items()],
        "Labels": labels(settings, lane, job),
        "HostConfig": host_config,
    }


def docker_time(text: str | None) -> float | None:
    """Seconds since the epoch from a Docker timestamp such as 2026-10-22T16:04:05.123456789Z;
    None for Docker's zero time (never started or never finished) or nothing."""
    if not text or text.startswith("0001-"):
        return None
    match = re.match(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)$", text)
    if match is None:
        return None
    fraction = (match.group(2) or ".0")[:7]
    zone = "+00:00" if match.group(3) == "Z" else match.group(3)
    return datetime.fromisoformat(f"{match.group(1)}{fraction}{zone}").timestamp()
