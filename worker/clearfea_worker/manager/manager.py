# SPDX-License-Identifier: AGPL-3.0-or-later
"""The compute manager (M12.1, ADR-107): claims jobs through the API's claim route and runs each
in a fresh, hardened container of the worker image, one job at a time in each lane.

The container does the job's work, transfers and heartbeats as a worker does (`python -m
clearfea_worker job`) and reports its own outcome. The manager watches it, reports a container
that ended without reporting (killed, out of memory, never started) as ClearFEA's fault, and
removes it with its scratch volume. It holds no state of record: after a restart it finds its
containers by their labels, follows the ones still running and clears up the rest.

For support (M12.3, ADR-109) it samples each job container's statistics every 5 s and sends what
the container used once it has ended, and sends the host's load with each check-in.
"""

import json
import logging
import os
import shutil
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..api import AccessBlocked, ApiClient, ApiError, ClaimedJob
from ..runner import ACCESS_BACKOFF_MAX_SECONDS
from ..spec.jobs_schema import ContainerStats, HostLoad, WorkerSoftware
from ..versions import clearfea_version
from .config import Lane, ManagerSettings
from .containers import (
    HOST_LABEL,
    JOB_LABEL,
    JOB_TYPE_LABEL,
    JOB_USER,
    LANE_LABEL,
    JobTooLarge,
    container_spec,
    docker_time,
    resource_name,
    worker_id,
)
from .docker import DockerClient, DockerError
from .stats import SAMPLE_SECONDS, ContainerSampler, CpuTimes, host_load

log = logging.getLogger(__name__)

#: Failure causes the manager reports for a job whose container ended without reporting.
CONTAINER_EXITED = "container_exited"
CONTAINER_START_FAILED = "container_start_failed"
JOB_TIMEOUT = "job_timeout"
OUT_OF_MEMORY = "out_of_memory"

#: Pause before checking in again after a check-in failed.
CHECK_IN_RETRY_SECONDS = 30.0
#: Pause before looking for a missing worker image again.
IMAGE_RETRY_SECONDS = 60.0
#: Pause before looking at the scratch disk again after it was too full to claim a job.
DISK_RETRY_SECONDS = 60.0
#: Longest wait for the short container that reports an image's software versions.
SOFTWARE_TIMEOUT_SECONDS = 120.0


@dataclass
class _LaneState:
    lane: Lane
    client: ApiClient
    worker_id: str
    #: The job container the lane is running, with its job.
    container: str | None = None
    job_id: str | None = None
    job_type: str | None = None
    #: Set when the manager killed the container for running past job_max_seconds.
    timed_out: bool = False
    #: The running container's statistics so far, and when to sample them next (manager clock).
    sampler: ContainerSampler = field(default_factory=ContainerSampler)
    next_sample: float = 0.0
    #: When the lane next asks for a job (manager clock), and the pause after that while idle.
    next_claim: float = 0.0
    idle_pause: float = 0.0
    blocked: int = 0


@dataclass
class _Clocks:
    #: For scheduling claims.
    monotonic: Callable[[], float] = time.monotonic
    #: For comparing with Docker's timestamps.
    wall: Callable[[], float] = time.time


@dataclass
class Manager:
    settings: ManagerSettings
    docker: DockerClient
    client_factory: Callable[[ManagerSettings, str], ApiClient] | None = None
    clocks: _Clocks = field(default_factory=_Clocks)
    #: Where the host's /proc is read for its load; inside a container it is still the host's.
    proc: Path = Path("/proc")
    #: Free bytes on the disk at a path; replaced in tests.
    free_bytes: Callable[[str], int] = lambda path: shutil.disk_usage(path).free
    _lanes: list[_LaneState] = field(default_factory=list, init=False)
    _software: dict[str, WorkerSoftware] = field(default_factory=dict, init=False)
    _host_cpus: int = field(default=1, init=False)
    _next_check_in: float = field(default=0.0, init=False)
    _cpu_times: CpuTimes | None = field(default=None, init=False)
    _disk: str = field(default="/", init=False)
    _load_failed: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        factory = self.client_factory or _default_client
        for lane in self.settings.lanes:
            wid = worker_id(self.settings, lane)
            self._lanes.append(
                _LaneState(lane, factory(self.settings, wid), wid, idle_pause=self._first_pause)
            )

    @property
    def _first_pause(self) -> float:
        return self.settings.poll_seconds

    @property
    def lanes(self) -> list[_LaneState]:
        return self._lanes

    # Start-up --------------------------------------------------------------------------------

    def start(self) -> None:
        """Reads the host's CPUs and takes over the containers a previous manager on this host
        left: a running one is followed again (one per lane), any other is cleared up."""
        info = self.docker.info()
        self._host_cpus = int(info.get("NCPU") or 1)
        # The disk whose free space counts: where Docker keeps the jobs' scratch volumes (the
        # scratch path of ADR-108, or Docker's data root when the manager can see it), else its
        # own root.
        root = str(info.get("DockerRootDir") or "")
        self._disk = (
            self.settings.disk_path
            or self.settings.scratch_path
            or (root if root and os.path.isdir(root) else "/")
        )
        log.info(
            "Manager on %s: %d CPUs, %.1f GiB, Docker %s; lanes %s",
            self.settings.host,
            self._host_cpus,
            int(info.get("MemTotal") or 0) / 1024**3,
            info.get("ServerVersion", "?"),
            ", ".join(
                f"{s.lane.name} ({'/'.join(s.lane.job_types)}; "
                f"{s.lane.cpuset or s.lane.cpus} CPU, {s.lane.memory_bytes / 1024**3:.1f} GiB)"
                for s in self._lanes
            ),
        )
        by_name = {s.lane.name: s for s in self._lanes}
        for summary in self.docker.containers(f"{HOST_LABEL}={self.settings.host}"):
            labels = summary.get("Labels") or {}
            state = by_name.get(labels.get(LANE_LABEL, ""))
            container = summary["Id"]
            job_id = labels.get(JOB_LABEL)
            running = summary.get("State") == "running"
            if state is not None and job_id and running and state.container is None:
                state.container, state.job_id = container, job_id
                state.job_type = labels.get(JOB_TYPE_LABEL)
                log.info("Following job %s again in the %s lane", job_id, state.lane.name)
                continue
            if running:
                log.warning("Stopping container %s: its lane already runs a job", container[:12])
                self.docker.kill(container)
                self.docker.wait(container, SOFTWARE_TIMEOUT_SECONDS)
            # Reported through the lane it ran in; one this manager has no lane for is removed.
            reporter = state or self._lanes[0]
            self._finish(reporter, container, job_id, labels.get(JOB_TYPE_LABEL))

    # The loop --------------------------------------------------------------------------------

    def run(self, stop: threading.Event) -> None:
        """Ticks until ``stop`` is set. Leaves running job containers alone when it stops: a
        restarted manager follows them again."""
        self.start()
        while not stop.is_set():
            try:
                self.tick()
            except DockerError as error:
                log.error("%s", error)
            stop.wait(self.settings.poll_seconds)
        log.info("Manager stopping; job containers keep running and are followed after a restart")

    def tick(self) -> None:
        if self.clocks.monotonic() >= self._next_check_in:
            self._check_in()
        for state in self._lanes:
            if state.container is not None:
                self._watch(state)
            elif self.clocks.monotonic() >= state.next_claim:
                self._claim(state)

    def _check_in(self) -> None:
        """Tells the API the host is up, whatever the lanes are doing (M12.4, ADR-120): with
        MACHINES=vps it refuses new jobs while no host has checked in for 2 minutes."""
        now = self.clocks.monotonic()
        load = self._host_load()
        try:
            interval = self._lanes[0].client.check_in(self.settings.host, clearfea_version(), load)
        except ApiError as error:
            log.warning("Check-in failed: %s", error)
            self._next_check_in = now + CHECK_IN_RETRY_SECONDS
            return
        self._next_check_in = now + interval

    def _host_load(self) -> HostLoad | None:
        """The host's load for the check-in, or None (said once) when it cannot be read."""
        try:
            running = int(self.docker.info().get("ContainersRunning") or 0)
            load, self._cpu_times = host_load(self.proc, Path(self._disk), running, self._cpu_times)
        except (OSError, ValueError, IndexError, DockerError) as error:
            if not self._load_failed:
                log.warning("Cannot read the host's load, so check-ins go without it: %s", error)
            self._load_failed = True
            return None
        self._load_failed = False
        return load

    # A busy lane -----------------------------------------------------------------------------

    def _watch(self, state: _LaneState) -> None:
        assert state.container is not None
        info = self.docker.inspect(state.container)
        status = None if info is None else info["State"].get("Status")
        if status == "running":
            now = self.clocks.monotonic()
            if now >= state.next_sample:
                state.sampler.add(self.docker.stats(state.container))
                state.next_sample = now + SAMPLE_SECONDS
            started = docker_time(info["State"].get("StartedAt")) if info else None
            age = None if started is None else self.clocks.wall() - started
            if age is not None and age > self.settings.job_max_seconds and not state.timed_out:
                log.warning(
                    "Job %s has run %.0f s, past the %.0f s limit; stopping its container",
                    state.job_id,
                    age,
                    self.settings.job_max_seconds,
                )
                state.timed_out = True
                self.docker.kill(state.container)
            return
        self._finish(state, state.container, state.job_id, state.job_type, info)
        state.container = state.job_id = state.job_type = None
        state.timed_out = False
        state.sampler, state.next_sample = ContainerSampler(), 0.0
        # Look for the next job at once.
        state.next_claim = 0.0
        state.idle_pause = self._first_pause

    def _finish(
        self,
        state: _LaneState,
        container: str,
        job_id: str | None,
        job_type: str | None,
        info: dict[str, Any] | None = None,
    ) -> None:
        """Clears up an ended container. One that exited 0 reported its job; any other way of
        ending is reported here as ClearFEA's fault, with the time it had the machine. The API
        queues the job again when the fault was the machine's (M12.2, ADR-108)."""
        info = info if info is not None else self.docker.inspect(container)
        container_state = (info or {}).get("State") or {}
        code = container_state.get("ExitCode")
        reported = container_state.get("Status") == "exited" and code == 0
        started = docker_time(container_state.get("StartedAt"))
        finished = docker_time(container_state.get("FinishedAt"))
        run_ms = 0
        if started is not None:
            end = finished if finished is not None else self.clocks.wall()
            run_ms = max(0, round((end - started) * 1000))
        if job_id is not None and not reported:
            billable_ms = run_ms
            peak_memory_bytes = None
            if container_state.get("OOMKilled"):
                cause = OUT_OF_MEMORY
                # The kernel stops a container when it reaches its memory limit, so that was its
                # peak (ADR-108); the limit it was created with, else its lane's.
                limit = ((info or {}).get("HostConfig") or {}).get("Memory")
                peak_memory_bytes = int(limit) if limit else state.lane.memory_bytes
            elif state.timed_out:
                cause = JOB_TIMEOUT
            elif started is None:
                cause = CONTAINER_START_FAILED
            else:
                cause = CONTAINER_EXITED
            tail = self.docker.logs(container) if info is not None else ""
            log.warning(
                "Job %s (%s) ended without reporting: container %s, exit code %s, %s. "
                "Its last log lines:\n%s",
                job_id,
                job_type,
                container[:12],
                code,
                cause,
                tail.strip() or "(none)",
            )
            try:
                state.client.fail(
                    job_id,
                    "platform_fault",
                    cause,
                    billable_ms=billable_ms,
                    peak_memory_bytes=peak_memory_bytes,
                )
            except ApiError as error:
                log.info("The API did not take job %s's failure: %s", job_id, error)
        elif job_id is not None:
            log.info("Job %s (%s) finished in the %s lane", job_id, job_type, state.lane.name)
        if job_id is not None:
            self._send_stats(
                state,
                job_id,
                image=str((info or {}).get("Image") or self.settings.image),
                exit_code=code if started is not None and isinstance(code, int) else None,
                out_of_memory=bool(container_state.get("OOMKilled")),
                run_ms=run_ms,
            )
        self.docker.remove(container)
        if job_id is not None:
            self.docker.remove_volume(resource_name(job_id))

    # An idle lane ----------------------------------------------------------------------------

    def _claim(self, state: _LaneState) -> None:
        now = self.clocks.monotonic()
        image_id = self.docker.image_id(self.settings.image)
        if image_id is None:
            log.error(
                "The worker image %s is not loaded on this host, so no job is claimed. Build or "
                "load it; trying again in %.0f s.",
                self.settings.image,
                IMAGE_RETRY_SECONDS,
            )
            state.next_claim = now + IMAGE_RETRY_SECONDS
            return
        software = self._image_software(image_id)
        if software is None:
            state.next_claim = now + IMAGE_RETRY_SECONDS
            return
        if not self._scratch_has_room():
            state.next_claim = now + DISK_RETRY_SECONDS
            return
        try:
            job = state.client.claim(list(state.lane.job_types), software=software)
            state.blocked = 0
        except AccessBlocked as error:
            state.blocked += 1
            pause = min(self.settings.poll_seconds * 2**state.blocked, ACCESS_BACKOFF_MAX_SECONDS)
            log.error("%s Trying again in %.0f s.", error, pause)
            state.next_claim = now + pause
            return
        except ApiError as error:
            log.warning("%s", error)
            job = None
        if job is None:
            state.next_claim = now + state.idle_pause
            state.idle_pause = min(state.idle_pause * 2, self.settings.idle_poll_max_seconds)
            return
        state.idle_pause = self._first_pause
        log.info("Claimed job %s (%s) in the %s lane", job.id, job.type, state.lane.name)
        self._start_job(state, job, image_id)

    def _start_job(self, state: _LaneState, job: ClaimedJob, image_id: str) -> None:
        name = resource_name(job.id)
        container = None
        try:
            spec = container_spec(self.settings, state.lane, job, image_id, self._host_cpus)
            self.docker.create_volume(name, spec["Labels"])
            container = self.docker.create_container(name, spec)
            self.docker.start(container)
        except (DockerError, JobTooLarge) as error:
            log.error("Job %s's container did not start: %s", job.id, error)
            try:
                state.client.fail(job.id, "platform_fault", CONTAINER_START_FAILED, billable_ms=0)
            except ApiError as api_error:
                log.warning("%s", api_error)
            self._send_stats(
                state, job.id, image=image_id, exit_code=None, out_of_memory=False, run_ms=0
            )
            try:
                if container is not None:
                    self.docker.remove(container)
                self.docker.remove_volume(name)
            except DockerError as cleanup:
                log.warning("Clearing up job %s's container: %s", job.id, cleanup)
            # Wait before the next claim, so a broken Docker set-up does not fail the queue.
            state.next_claim = self.clocks.monotonic() + IMAGE_RETRY_SECONDS
            return
        state.container, state.job_id, state.job_type = container, job.id, job.type

    def _send_stats(
        self,
        state: _LaneState,
        job_id: str,
        *,
        image: str,
        exit_code: int | None,
        out_of_memory: bool,
        run_ms: int,
    ) -> None:
        """Sends what the job's container used to its try's statistics (M12.3, ADR-109). Lost
        statistics lose nothing else, so a refusal is only logged."""
        stats = ContainerStats(
            worker_id=state.worker_id,
            host=self.settings.host,
            lane=state.lane.name,
            image=image[:100],
            exit_code=exit_code,
            out_of_memory=out_of_memory,
            run_ms=run_ms,
            **state.sampler.figures(),
        )
        try:
            state.client.container_stats(job_id, stats)
        except ApiError as error:
            log.info("The API did not take job %s's statistics: %s", job_id, error)

    def _scratch_has_room(self) -> bool:
        """Whether the disk of the job containers' scratch volumes has the free space a job may
        need (ADR-108). A full disk would fail every job queued, so none is claimed until the
        sweep or an admin frees space; a job already running goes on."""
        path = self.settings.scratch_path
        if path is None:
            return True
        try:
            free = self.free_bytes(path)
        except OSError as error:
            log.error("Cannot read the free space at %s (%s), so no job is claimed.", path, error)
            return False
        if free >= self.settings.scratch_min_free_bytes:
            return True
        log.error(
            "The scratch disk at %s has %.1f GiB free, under the %.1f GiB a job may need, so no "
            "job is claimed. Free space on the solver host; trying again in %.0f s.",
            path,
            free / 1024**3,
            self.settings.scratch_min_free_bytes / 1024**3,
            DISK_RETRY_SECONDS,
        )
        return False

    def _image_software(self, image_id: str) -> WorkerSoftware | None:
        """The versions inside the image, which the claim records as what ran the job (ADR-032),
        read once per image by `python -m clearfea_worker software` in a short container."""
        if image_id in self._software:
            return self._software[image_id]
        name = f"clearfea-software-{self.settings.host}-{image_id.split(':')[-1][:12]}"
        self.docker.remove(name)
        container = self.docker.create_container(
            name,
            {
                "Image": image_id,
                "Cmd": ["software"],
                "User": JOB_USER,
                "Labels": {HOST_LABEL: self.settings.host},
                "HostConfig": {
                    "NetworkMode": "none",
                    "ReadonlyRootfs": True,
                    "CapDrop": ["ALL"],
                    "SecurityOpt": ["no-new-privileges:true"],
                    "Tmpfs": {"/tmp": "rw,nosuid,nodev,size=64m"},
                },
            },
        )
        try:
            self.docker.start(container)
            code = self.docker.wait(container, SOFTWARE_TIMEOUT_SECONDS)
            output = self.docker.logs(container, tail=20)
        finally:
            self.docker.remove(container)
        try:
            if code != 0:
                raise ValueError(f"exit code {code}")
            line = [line for line in output.splitlines() if line.startswith("{")][-1]
            software = WorkerSoftware.model_validate(json.loads(line))
        except (ValueError, IndexError) as error:
            log.error(
                "The worker image %s did not report its software (%s); its output:\n%s",
                self.settings.image,
                error,
                output.strip(),
            )
            return None
        log.info("Worker image %s: %s", image_id[:19], software.model_dump_json(by_alias=True))
        self._software[image_id] = software
        return software


def _default_client(settings: ManagerSettings, wid: str) -> ApiClient:
    worker = settings.worker
    access = None
    if worker.access_client_id and worker.access_client_secret:
        access = (worker.access_client_id, worker.access_client_secret)
    return ApiClient(worker.api_url, worker.worker_token, wid, access=access)
