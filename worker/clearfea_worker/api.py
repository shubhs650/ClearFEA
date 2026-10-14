# SPDX-License-Identifier: AGPL-3.0-or-later
"""Client for the API's internal job routes (docs/ARCHITECTURE.md section 6).

HTTP through the standard library. Request and response shapes are the Pydantic models
generated from packages/spec/schemas/jobs.schema.json.
"""

import json
import urllib.error
import urllib.request
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

    def heartbeat(self, job_id: str, stage: str | None) -> HeartbeatAction:
        path = f"/jobs/{job_id}/heartbeat"
        _, body = self._post(path, HeartbeatRequest(worker_id=self._worker_id, stage=stage))
        return self._parse(HeartbeatResponse, path, body).action

    def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        request = CompleteSucceeded(worker_id=self._worker_id, status="succeeded", result=result)
        self._post(f"/jobs/{job_id}/complete", request)

    def fail(self, job_id: str, category: FailureCategory, cause: str) -> None:
        request = CompleteFailed(
            worker_id=self._worker_id,
            status="failed",
            failure_category=category,
            failure_cause=cause,
        )
        self._post(f"/jobs/{job_id}/complete", request)
