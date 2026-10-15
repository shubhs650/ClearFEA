# SPDX-License-Identifier: AGPL-3.0-or-later
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from clearfea_worker.api import ApiClient, ApiError, ClaimedJob
from clearfea_worker.config import Settings
from clearfea_worker.jobs import HANDLERS, JobContext
from clearfea_worker.runner import run_forever, run_once
from clearfea_worker.spec.geometry_schema import ImportResult

from .fake_api import FakeApi
from .step_models import block_with_hole


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
        assert api.calls[0][1] == {"workerId": "w1", "jobTypes": ["import", "noop"]}


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


def test_fake_api_refuses_bodies_outside_the_schema() -> None:
    with FakeApi() as api:
        request = urllib.request.Request(
            f"{api.url}/internal/jobs/claim",
            data=json.dumps({"workerId": "w1", "jobTypes": ["bake"]}).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {api.token}"},
        )
        with pytest.raises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request)
        assert raised.value.code == 400


def test_client_refuses_to_send_an_empty_failure_cause() -> None:
    client = ApiClient("http://127.0.0.1:9", "t", "w1")
    with pytest.raises(ValidationError):
        client.fail("job", "platform_fault", "")


def test_runs_an_import_job_through_its_transfer_urls(tmp_path: Path) -> None:
    step = block_with_hole(tmp_path / "block.step").read_bytes()
    with FakeApi() as api:
        api.enqueue(
            "j1",
            "import",
            params={"confirmedUnit": None},
            downloads={"model.step": step},
            uploads=("topology.json", "display.bin"),
        )
        settings = settings_for(api)
        assert run_once(client_for(settings), settings, HANDLERS) is True
        job = api.jobs["j1"]
        assert job["status"] == "succeeded", job.get("outcome")
        result = ImportResult.model_validate(job["outcome"]["result"])
        assert result.unit.detected_unit == "mm"
        assert result.faces == 7
        topology = json.loads(api.uploads[("j1", "topology.json")])
        assert len(topology["faces"]) == 7
        assert api.uploads[("j1", "display.bin")][:4] == b"CFDM"


def test_an_unusable_file_fails_the_import_as_the_users_fault() -> None:
    with FakeApi() as api:
        api.enqueue(
            "j1",
            "import",
            params={"confirmedUnit": None},
            downloads={"model.step": b"solid cube\nendsolid cube\n"},
            uploads=("topology.json", "display.bin"),
        )
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert outcome["status"] == "failed"
        assert outcome["failureCategory"] == "user_fault"
        assert outcome["failureCause"] == "not_step"
        assert "not a STEP file" in outcome["failureMessage"]
        assert api.uploads == {}


def test_a_missing_download_is_a_platform_fault() -> None:
    with FakeApi() as api:
        api.enqueue("j1", "import", params={"confirmedUnit": None})
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "platform_fault",
            "transfer_missing",
        )
