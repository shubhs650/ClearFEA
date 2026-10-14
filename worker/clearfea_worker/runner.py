# SPDX-License-Identifier: AGPL-3.0-or-later
"""Claim loop: claim a job, run its handler with heartbeats, report the outcome."""

import logging
import threading
from collections.abc import Callable

from .api import ApiClient, ApiError, ClaimedJob
from .config import Settings
from .jobs import HANDLERS, Handler, JobContext

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

    def beat(self) -> None:
        try:
            action = self._client.heartbeat(self._job.id, self._context.stage)
        except ApiError as error:
            log.warning("Heartbeat for job %s failed: %s", self._job.id, error)
            return
        if action != "continue":
            log.info("API asked to %s job %s", action, self._job.id)
            self._context.cancelled.set()

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


def run_job(
    client: ApiClient,
    job: ClaimedJob,
    handlers: dict[str, Handler],
    heartbeat_seconds: float,
) -> str:
    """Runs one claimed job and reports its outcome. Returns the final status."""
    handler = handlers.get(job.type)
    if handler is None:
        client.fail(job.id, "platform_fault", "unsupported_job_type")
        return "failed"
    context = JobContext()
    with _Heartbeat(client, job, context, heartbeat_seconds):
        try:
            result = handler(job, context)
        except Exception:
            log.exception("Job %s (%s) raised an error", job.id, job.type)
            client.fail(job.id, "platform_fault", "internal_error")
            return "failed"
    if context.cancelled.is_set():
        log.info("Job %s was cancelled or stopped by the API; not reporting a result", job.id)
        return "cancelled"
    client.succeed(job.id, result)
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
    return ApiClient(settings.api_url, settings.worker_token, settings.worker_id)
