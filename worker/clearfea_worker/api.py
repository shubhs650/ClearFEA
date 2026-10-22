# SPDX-License-Identifier: AGPL-3.0-or-later
"""Client for the API's internal job routes (docs/ARCHITECTURE.md section 6).

HTTP through the standard library. Request and response shapes are the Pydantic models
generated from packages/spec/schemas/jobs.schema.json.
"""

import json
import shutil
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from .spec.jobs_schema import (
    ClaimedJob,
    ClaimRequest,
    ClaimResponse,
    CompleteFailed,
    CompleteStopped,
    CompleteSucceeded,
    ContainerStats,
    FailureCategory,
    HeartbeatAction,
    HeartbeatRequest,
    HeartbeatResponse,
    HostCheckIn,
    HostCheckInResponse,
    HostLoad,
    JobType,
    Metering,
    WorkerSoftware,
)

__all__ = ["AccessBlocked", "ApiClient", "ApiError", "ClaimedJob", "HeartbeatAction"]


class ApiError(Exception):
    """The API could not be reached or answered with an error."""


class AccessBlocked(ApiError):
    """The API's address answered with a web page instead of JSON: Cloudflare Access's sign-in
    page in front of the live site (ADR-111), or something else in the way. Retrying at the
    usual pace cannot help, so the worker backs off."""


#: Pauses before the second and third try of a file transfer that failed on the server's side
#: or on the connection. The local API (wrangler dev) drops the next request after a transfer
#: of about a gigabyte, the raw output of a modal run at its element limit (M9.1); storage in
#: the cloud can fail a request now and then too. A transfer sends or fetches the whole file
#: again, so a retry cannot store half of one.
TRANSFER_RETRY_PAUSES = (1.0, 4.0)

#: Sent with every request. Cloudflare, in front of the live site, refuses urllib's default
#: "Python-urllib/3.x" agent with "error code: 1010" (M10.9), so a machine with it never gets a job.
USER_AGENT = "ClearFEA-worker/1.0 (+https://github.com/shubhs650/ClearFEA)"


def _is_json(content_type: str | None) -> bool:
    return (content_type or "").split(";")[0].strip().lower() == "application/json"


def _retryable(error: Exception) -> bool:
    """A 5xx answer or no answer at all; a 4xx answer would only be repeated."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code >= 500
    return isinstance(error, urllib.error.URLError | OSError)


class ApiClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        worker_id: str,
        timeout: float = 30.0,
        software: WorkerSoftware | None = None,
        machine_size: str | None = None,
        access: tuple[str, str] | None = None,
    ) -> None:
        """``software`` is sent with every claim, so the API records what ran each job.
        ``machine_size`` limits claims to that size's jobs (M10.6); None claims any size's.
        ``access`` is the Cloudflare Access service token (client id, secret), sent with every
        request to the API's address (ADR-111)."""
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._worker_id = worker_id
        self._timeout = timeout
        self._software = software
        self._machine_size = machine_size
        self._access = access

    def _headers(self, url: str) -> dict[str, str]:
        """The worker token goes only to the API's own internal routes, and the Access service
        token only to the API's address, never elsewhere (such as a signed storage link)."""
        headers = {"User-Agent": USER_AGENT}
        if self._access is not None and url.startswith(f"{self._base_url}/"):
            headers["CF-Access-Client-Id"], headers["CF-Access-Client-Secret"] = self._access
        if url.startswith(f"{self._base_url}/internal/"):
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _blocked(self, status: int) -> AccessBlocked:
        hint = (
            "the Cloudflare Access service token it was given is wrong or not admitted by the "
            "application's Service Auth policy"
            if self._access is not None
            else "set CLEARFEA_ACCESS_CLIENT_ID and CLEARFEA_ACCESS_CLIENT_SECRET to the Access "
            "service token"
        )
        return AccessBlocked(
            f"The API at {self._base_url} answered with a web page instead of JSON "
            f"(HTTP {status}), most likely Cloudflare Access's sign-in page: {hint} "
            "(docs/DEPLOYMENT.md section 1.8)."
        )

    def _transfer_error(self, url: str, error: Exception) -> ApiError:
        if isinstance(error, urllib.error.HTTPError):
            raw = error.read()
            try:
                message = json.loads(raw).get("error", raw.decode(errors="replace"))
            except (ValueError, AttributeError):
                message = raw.decode(errors="replace")
            return ApiError(f"Transfer {url} answered {error.code}: {message}")
        return ApiError(f"Transfer {url} failed: {getattr(error, 'reason', error)}")

    def download(self, url: str, destination: Path) -> None:
        """Streams the file at a transfer URL to ``destination``."""

        def fetch() -> None:
            request = urllib.request.Request(url, method="GET", headers=self._headers(url))
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                # The API serves files as octet-stream; a web page there is Access's sign-in.
                kind = response.headers.get("Content-Type", "")
                if url.startswith(f"{self._base_url}/") and kind.startswith("text/html"):
                    raise self._blocked(response.status)
                with destination.open("wb") as f:
                    shutil.copyfileobj(response, f)

        self._transfer(url, fetch)

    def upload(self, url: str, source: Path) -> None:
        """Sends ``source`` to a transfer URL."""
        headers = {
            **self._headers(url),
            "Content-Type": "application/octet-stream",
            "Content-Length": str(source.stat().st_size),
        }

        def send() -> None:
            with source.open("rb") as f:
                request = urllib.request.Request(url, data=f, method="PUT", headers=headers)
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    response.read()

        self._transfer(url, send)

    def _transfer(self, url: str, attempt: Callable[[], None]) -> None:
        """Runs ``attempt``, again after each pause of TRANSFER_RETRY_PAUSES while it fails in
        a way a retry can fix."""
        for pause in (*TRANSFER_RETRY_PAUSES, None):
            try:
                attempt()
                return
            except (urllib.error.URLError, OSError) as error:
                if pause is None or not _retryable(error):
                    raise self._transfer_error(url, error) from None
                if isinstance(error, urllib.error.HTTPError):
                    error.read()
                time.sleep(pause)

    def _post(self, path: str, body: BaseModel) -> tuple[int, Any]:
        data = body.model_dump_json(by_alias=True, exclude_unset=True).encode()
        request = urllib.request.Request(
            f"{self._base_url}/internal{path}",
            data=data,
            method="POST",
            headers={
                **self._headers(f"{self._base_url}/internal{path}"),
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
                if not raw:
                    return response.status, None
                # Access answers with a redirect to its sign-in page, which urllib follows.
                if not _is_json(response.headers.get("Content-Type")):
                    raise self._blocked(response.status)
                try:
                    return response.status, json.loads(raw)
                except ValueError:
                    raise self._blocked(response.status) from None
        except urllib.error.HTTPError as error:
            raw = error.read()
            if error.headers.get("Content-Type", "").startswith("text/html"):
                raise self._blocked(error.code) from None
            try:
                message = json.loads(raw).get("error", raw.decode(errors="replace"))
            except (ValueError, AttributeError):
                message = raw.decode(errors="replace")
            raise ApiError(f"The API answered {error.code} on {path}: {message}") from None
        except (urllib.error.URLError, OSError) as error:
            reason = getattr(error, "reason", error)
            raise ApiError(
                f"Cannot reach the API at {self._base_url}: {reason}. "
                "Start it with `pnpm --filter @clearfea/api dev`."
            ) from None

    def _parse[T: BaseModel](self, model: type[T], path: str, body: Any) -> T:
        try:
            return model.model_validate(body)
        except ValidationError as error:
            raise ApiError(
                f"The API answered {path} with a body that is not a valid {model.__name__} "
                f"(packages/spec/schemas/jobs.schema.json): {error}"
            ) from None

    def claim(
        self, job_types: list[JobType], software: WorkerSoftware | None = None
    ) -> ClaimedJob | None:
        """Claims a job of one of these types. ``software`` replaces the client's own for this
        claim: the compute manager names the software of the image that will run the job."""
        software = software or self._software
        extra: dict[str, Any] = {} if software is None else {"software": software}
        if self._machine_size is not None:
            extra["machine_size"] = self._machine_size
        request = ClaimRequest(worker_id=self._worker_id, job_types=job_types, **extra)
        status, body = self._post("/jobs/claim", request)
        if status == 204 or body is None:
            return None
        return self._parse(ClaimResponse, "/jobs/claim", body).job

    def check_in(
        self, host: str, manager_version: str | None = None, load: HostLoad | None = None
    ) -> int:
        """Says the solver host is up (M12.4, ADR-120), with its load (M12.3, ADR-109). Returns
        the seconds until the next check-in is due."""
        extra: dict[str, Any] = {}
        if manager_version is not None:
            extra["manager_version"] = manager_version
        if load is not None:
            extra["load"] = load
        _, body = self._post("/hosts/check-in", HostCheckIn(host=host, **extra))
        return self._parse(HostCheckInResponse, "/hosts/check-in", body).interval_seconds

    def container_stats(self, job_id: str, stats: ContainerStats) -> None:
        """Sends what the compute manager measured of a job's container once it has ended
        (M12.3, ADR-109). ``stats`` names this client's worker id."""
        self._post(f"/jobs/{job_id}/stats", stats)

    def heartbeat(self, job_id: str, stage: str | None, log: str = "") -> HeartbeatAction:
        """Reports the job alive at ``stage``, with any log text written since the last one."""
        path = f"/jobs/{job_id}/heartbeat"
        extra = {"log": log} if log else {}
        request = HeartbeatRequest(worker_id=self._worker_id, stage=stage, **extra)
        _, body = self._post(path, request)
        return self._parse(HeartbeatResponse, path, body).action

    def succeed(self, job_id: str, result: dict[str, Any], billable_ms: int) -> None:
        """Reports success with the job's measured time on the machine (ADR-033)."""
        request = CompleteSucceeded(
            worker_id=self._worker_id,
            status="succeeded",
            metering=Metering(billable_ms=billable_ms),
            result=result,
        )
        self._post(f"/jobs/{job_id}/complete", request)

    def fail(
        self,
        job_id: str,
        category: FailureCategory,
        cause: str,
        message: str | None = None,
        *,
        billable_ms: int,
    ) -> None:
        """Reports failure with the job's measured time; the API decides who pays (ADR-033)."""
        extra = {} if message is None else {"failure_message": message}
        request = CompleteFailed(
            worker_id=self._worker_id,
            status="failed",
            failure_category=category,
            failure_cause=cause,
            metering=Metering(billable_ms=billable_ms),
            **extra,
        )
        self._post(f"/jobs/{job_id}/complete", request)

    def stopped(self, job_id: str, *, billable_ms: int) -> None:
        """Reports that the job ended because a heartbeat asked it to (M8.2), with the time it
        used; the API records it as cancelled or stopped at its limit and charges the time."""
        request = CompleteStopped(
            worker_id=self._worker_id, status="stopped", metering=Metering(billable_ms=billable_ms)
        )
        self._post(f"/jobs/{job_id}/complete", request)
