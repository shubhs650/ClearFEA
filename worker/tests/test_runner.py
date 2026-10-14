# SPDX-License-Identifier: AGPL-3.0-or-later
import threading
from typing import Any

import pytest

from clearfea_worker.api import ApiClient, ApiError, ClaimedJob
from clearfea_worker.config import Settings
from clearfea_worker.jobs import HANDLERS, JobContext
from clearfea_worker.runner import run_forever, run_once

from .fake_api import FakeApi


def settings_for(api: FakeApi, token: str = "t") -> Settings:
    return Settings(
        api_url=api.url,
        worker_token=token,
        worker_id="w1",
        poll_seconds=0.01,
        heartbeat_seconds=0.01,
    )


def client_for(settings: Settings) -> ApiClient:
    return ApiClient(settings.api_url, settings.worker_token, settings.worker_id)


def test_completes_a_noop_job() -> None:
    with FakeApi() as api:
        api.enqueue("j1")
        settings = settings_for(api)
        assert run_once(client_for(settings), settings, HANDLERS) is True
        job = api.jobs["j1"]
        assert job["status"] == "succeeded"
        assert job["outcome"]["result"] == {"message": "No-op job completed."}
        paths = [path for path, _ in api.calls]
        assert paths[0] == "/internal/jobs/claim"
        assert "/internal/jobs/j1/heartbeat" in paths
        assert paths[-1] == "/internal/jobs/j1/complete"
        assert api.calls[0][1] == {"workerId": "w1", "jobTypes": ["noop"]}


def test_returns_false_when_nothing_is_queued() -> None:
    with FakeApi() as api:
        settings = settings_for(api)
        assert run_once(client_for(settings), settings, HANDLERS) is False


def test_reports_a_handler_error_as_platform_fault() -> None:
    def broken(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
        raise RuntimeError("boom")

    with FakeApi() as api:
        api.enqueue("j1")
        settings = settings_for(api)
        run_once(client_for(settings), settings, {"noop": broken})
        outcome = api.jobs["j1"]["outcome"]
        assert outcome["status"] == "failed"
        assert outcome["failureCategory"] == "platform_fault"
        assert outcome["failureCause"] == "internal_error"


def test_does_not_report_success_after_a_cancel() -> None:
    def slow(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
        assert context.cancelled.wait(5), "the heartbeat never passed on the cancel"
        return {}

    with FakeApi() as api:
        api.enqueue("j1")
        api.heartbeat_action = "cancel"
        settings = settings_for(api)
        run_once(client_for(settings), settings, {"noop": slow})
        assert "outcome" not in api.jobs["j1"]


def test_wrong_token_raises_a_plain_error() -> None:
    with FakeApi() as api:
        settings = settings_for(api, token="wrong")
        with pytest.raises(ApiError, match="401.*token"):
            run_once(client_for(settings), settings, HANDLERS)


def test_unreachable_api_names_the_fix() -> None:
    client = ApiClient("http://127.0.0.1:9", "t", "w1", timeout=2)
    with pytest.raises(ApiError, match="pnpm --filter @clearfea/api dev"):
        client.claim(["noop"])


def test_run_forever_keeps_polling_and_stops_cleanly() -> None:
    with FakeApi() as api:
        settings = settings_for(api)
        stop = threading.Event()
        thread = threading.Thread(target=run_forever, args=(settings,), kwargs={"stop": stop})
        thread.start()
        api.enqueue("j1")
        api.enqueue("j2")
        for _ in range(500):
            if all(api.jobs[j]["status"] == "succeeded" for j in ("j1", "j2")):
                break
            stop.wait(0.01)
        stop.set()
        thread.join(5)
        assert not thread.is_alive()
        assert api.jobs["j1"]["status"] == "succeeded"
        assert api.jobs["j2"]["status"] == "succeeded"
