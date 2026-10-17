# SPDX-License-Identifier: AGPL-3.0-or-later
"""Claim loop: claim a job, run its handler with heartbeats, report the outcome."""

import logging
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path

from .api import ApiClient, ApiError, ClaimedJob
from .config import Settings
from .jobs import HANDLERS, Files, Handler, JobContext, JobFailure, JobStopped
from .versions import worker_software

log = logging.getLogger(__name__)


class _Heartbeat:
    """Sends a heartbeat on a timer while a handler runs; sets context.cancelled when told."""

    def __init__(
        self, client: ApiClient, job: ClaimedJob, context: JobContext, interval: float
    ) -> None:
        self._client = client
        self._job = job
        self._context = context
        self._interval = interval
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    #: Most heartbeats one beat sends to catch up on queued log text.
    MAX_LOG_POSTS = 16

    def beat(self) -> None:
        for _ in range(self.MAX_LOG_POSTS):
            text = self._context.take_log()
            try:
                action = self._client.heartbeat(self._job.id, self._context.stage, text)
            except ApiError as error:
                self._context.unread_log(text)
                log.warning("Heartbeat for job %s failed: %s", self._job.id, error)
                return
            if action != "continue":
                log.info("API asked to %s job %s", action, self._job.id)
                self._context.cancelled.set()
                return
            if not self._context.has_log():
                return

    def _loop(self) -> None:
        while not self._done.wait(self._interval):
            self.beat()

    def __enter__(self) -> "_Heartbeat":
        self.beat()  # moves the job from claimed to running
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._done.set()
        self._thread.join()
        if self._context.has_log():
            self.beat()  # the last log lines, before the job is completed


class _Meter:
    """Measures the billable phase (ADR-033): wall-clock time from the start to the end of the
    job's handler, which covers its downloads, the work and its uploads. Claiming, queue time and
    the worker's start-up are outside it."""

    def __init__(self, clock: Callable[[], int] = time.monotonic_ns) -> None:
        self._clock = clock
        self._start = clock()
        self._end: int | None = None

    def stop(self) -> None:
        if self._end is None:
            self._end = self._clock()

    @property
    def billable_ms(self) -> int:
        """Whole milliseconds, rounded up, so a started millisecond counts."""
        end = self._end if self._end is not None else self._clock()
        return -(-(end - self._start) // 1_000_000)


def run_job(
    client: ApiClient,
    job: ClaimedJob,
    handlers: dict[str, Handler],
    heartbeat_seconds: float,
    clock: Callable[[], int] = time.monotonic_ns,
) -> str:
    """Runs one claimed job and reports its outcome with its measured time. Returns the final
    status."""
    handler = handlers.get(job.type)
    if handler is None:
        client.fail(job.id, "platform_fault", "unsupported_job_type", billable_ms=0)
        return "failed"
    with (
        tempfile.TemporaryDirectory(prefix=f"job-{job.id}-") as workdir,
        _Heartbeat(client, job, context := JobContext(), heartbeat_seconds),
    ):
        context.files = Files(job, client, Path(workdir))
        meter = _Meter(clock)
        try:
            result = handler(job, context)
        except JobStopped:
            meter.stop()
            log.info("Job %s (%s) stopped as the API asked", job.id, job.type)
            client.stopped(job.id, billable_ms=meter.billable_ms)
            return "stopped"
        except JobFailure as failure:
            meter.stop()
            log.info("Job %s (%s) failed: %s", job.id, job.type, failure.message)
            client.fail(
                job.id,
                failure.category,
                failure.cause,
                failure.message,
                billable_ms=meter.billable_ms,
            )
            return "failed"
        except ApiError as error:
            meter.stop()
            log.warning("Job %s (%s): %s", job.id, job.type, error)
            client.fail(job.id, "platform_fault", "transfer_failed", billable_ms=meter.billable_ms)
            return "failed"
        except Exception:
            meter.stop()
            log.exception("Job %s (%s) raised an error", job.id, job.type)
            client.fail(job.id, "platform_fault", "internal_error", billable_ms=meter.billable_ms)
            return "failed"
        meter.stop()
    # A handler that finished before it saw a cancel reports its result all the same: the work
    # is done. Only a job the API has already ended refuses it.
    try:
        client.succeed(job.id, result, meter.billable_ms)
    except ApiError as error:
        if not context.cancelled.is_set():
            raise
        log.info("Job %s was ended by the API before its result: %s", job.id, error)
        return "cancelled"
    return "succeeded"


def run_once(client: ApiClient, settings: Settings, handlers: dict[str, Handler]) -> bool:
    """Claims and runs at most one job. Returns True if a job was claimed."""
    job = client.claim(sorted(handlers))
    if job is None:
        return False
    log.info("Claimed job %s (%s)", job.id, job.type)
    status = run_job(client, job, handlers, settings.heartbeat_seconds)
    log.info("Job %s finished: %s", job.id, status)
    return True


def run_forever(
    settings: Settings,
    handlers: dict[str, Handler] = HANDLERS,
    stop: threading.Event | None = None,
    client_factory: Callable[[Settings], ApiClient] | None = None,
) -> None:
    """Polls for jobs until `stop` is set. API errors are logged and retried after a pause."""
    stop = stop or threading.Event()
    client = (client_factory or _default_client)(settings)
    log.info("Worker %s polling %s for %s", settings.worker_id, settings.api_url, sorted(handlers))
    while not stop.is_set():
        try:
            claimed = run_once(client, settings, handlers)
        except ApiError as error:
            log.warning("%s", error)
            claimed = False
        if not claimed:
            stop.wait(settings.poll_seconds)


def _default_client(settings: Settings) -> ApiClient:
    software = worker_software()
    log.info("Worker software: %s", software.model_dump_json(by_alias=True))
    return ApiClient(settings.api_url, settings.worker_token, settings.worker_id, software=software)
