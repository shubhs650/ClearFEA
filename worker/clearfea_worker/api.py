# SPDX-License-Identifier: AGPL-3.0-or-later
"""Client for the API's internal job routes (docs/ARCHITECTURE.md section 6).

Uses only the standard library. Wire shapes are written out here until
packages/spec holds their schemas (M0.6).
"""

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal

HeartbeatAction = Literal["continue", "cancel", "stop"]


class ApiError(Exception):
    """The API could not be reached or answered with an error."""


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    type: str
    target_id: str | None


class ApiClient:
    def __init__(self, base_url: str, token: str, worker_id: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._worker_id = worker_id
        self._timeout = timeout

    def _post(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        data = json.dumps({"workerId": self._worker_id, **body}).encode()
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

    def claim(self, job_types: list[str]) -> ClaimedJob | None:
        status, body = self._post("/jobs/claim", {"jobTypes": job_types})
        if status == 204 or body is None:
            return None
        job = body["job"]
        return ClaimedJob(id=job["id"], type=job["type"], target_id=job.get("targetId"))

    def heartbeat(self, job_id: str, stage: str | None) -> HeartbeatAction:
        _, body = self._post(f"/jobs/{job_id}/heartbeat", {"stage": stage})
        action = (body or {}).get("action", "continue")
        return action if action in ("continue", "cancel", "stop") else "continue"

    def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        self._post(f"/jobs/{job_id}/complete", {"status": "succeeded", "result": result})

    def fail(self, job_id: str, category: str, cause: str) -> None:
        self._post(
            f"/jobs/{job_id}/complete",
            {"status": "failed", "failureCategory": category, "failureCause": cause},
        )
