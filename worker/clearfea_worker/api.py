# SPDX-License-Identifier: AGPL-3.0-or-later
"""Client for the API's internal job routes (docs/ARCHITECTURE.md section 6).

HTTP through the standard library. Request and response shapes are the Pydantic models
generated from packages/spec/schemas/jobs.schema.json.
"""

import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from .spec.jobs_schema import (
    ClaimedJob,
    ClaimRequest,
    ClaimResponse,
    CompleteFailed,
    CompleteSucceeded,
    FailureCategory,
    HeartbeatAction,
    HeartbeatRequest,
    HeartbeatResponse,
    JobType,
)

__all__ = ["ApiClient", "ApiError", "ClaimedJob", "HeartbeatAction"]


class ApiError(Exception):
    """The API could not be reached or answered with an error."""


class ApiClient:
    def __init__(self, base_url: str, token: str, worker_id: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._worker_id = worker_id
        self._timeout = timeout

    def _headers(self, url: str) -> dict[str, str]:
        """The worker token goes only to the API's own internal routes, never elsewhere."""
        if url.startswith(f"{self._base_url}/internal/"):
            return {"Authorization": f"Bearer {self._token}"}
        return {}

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
        request = urllib.request.Request(url, method="GET", headers=self._headers(url))
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                with destination.open("wb") as f:
                    shutil.copyfileobj(response, f)
        except (urllib.error.URLError, OSError) as error:
            raise self._transfer_error(url, error) from None

    def upload(self, url: str, source: Path) -> None:
        """Sends ``source`` to a transfer URL."""
        headers = {
            **self._headers(url),
            "Content-Type": "application/octet-stream",
            "Content-Length": str(source.stat().st_size),
        }
        try:
            with source.open("rb") as f:
                request = urllib.request.Request(url, data=f, method="PUT", headers=headers)
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    response.read()
        except (urllib.error.URLError, OSError) as error:
            raise self._transfer_error(url, error) from None

    def _post(self, path: str, body: BaseModel) -> tuple[int, Any]:
        data = body.model_dump_json(by_alias=True, exclude_unset=True).encode()
        request = urllib.request.Request(
            f"{self._base_url}/internal{path}",
            data=data,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
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

    def claim(self, job_types: list[JobType]) -> ClaimedJob | None:
        request = ClaimRequest(worker_id=self._worker_id, job_types=job_types)
        status, body = self._post("/jobs/claim", request)
        if status == 204 or body is None:
            return None
        return self._parse(ClaimResponse, "/jobs/claim", body).job

    def heartbeat(self, job_id: str, stage: str | None, log: str = "") -> HeartbeatAction:
        """Reports the job alive at ``stage``, with any log text written since the last one."""
        path = f"/jobs/{job_id}/heartbeat"
        extra = {"log": log} if log else {}
        request = HeartbeatRequest(worker_id=self._worker_id, stage=stage, **extra)
        _, body = self._post(path, request)
        return self._parse(HeartbeatResponse, path, body).action

    def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        request = CompleteSucceeded(worker_id=self._worker_id, status="succeeded", result=result)
        self._post(f"/jobs/{job_id}/complete", request)

    def fail(
        self, job_id: str, category: FailureCategory, cause: str, message: str | None = None
    ) -> None:
        extra = {} if message is None else {"failure_message": message}
        request = CompleteFailed(
            worker_id=self._worker_id,
            status="failed",
            failure_category=category,
            failure_cause=cause,
            **extra,
        )
        self._post(f"/jobs/{job_id}/complete", request)
