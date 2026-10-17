# SPDX-License-Identifier: AGPL-3.0-or-later
import json
import shutil
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from clearfea_worker import solver, versions
from clearfea_worker.api import ApiClient, ApiError, ClaimedJob
from clearfea_worker.config import Settings
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.jobs import (
    HANDLERS,
    LOG_CHUNK_CHARS,
    LOG_CUT_NOTE,
    LOG_STREAM_CHARS,
    JobContext,
)
from clearfea_worker.meshing.volume import write_volume_mesh
from clearfea_worker.results import read_fields, write_viewer_files
from clearfea_worker.runner import run_forever, run_job, run_once
from clearfea_worker.solver import SolverRun
from clearfea_worker.spec.geometry_schema import ImportResult
from clearfea_worker.spec.simulation_schema import MeshResult, SolveResult

from .deck_meshes import two_tets
from .fake_api import FakeApi
from .step_models import block_with_hole
from .test_deck import SNAPSHOTS, fixture_spec


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


def test_claims_carry_the_worker_software() -> None:
    software = versions.worker_software({"CLEARFEA_COMMIT": "d9d394b"})
    with FakeApi() as api:
        settings = settings_for(api)
        client = ApiClient(api.url, "t", "w1", software=software)
        assert run_once(client, settings, HANDLERS) is False
        assert api.calls[0][1]["software"] == software.model_dump(mode="json", by_alias=True)
        # Without software the claim leaves the field out rather than sending null.
        client_for(settings).claim(["noop"])
        assert "software" not in api.calls[1][1]


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
        assert api.calls[0][1] == {
            "workerId": "w1",
            "jobTypes": ["import", "mesh", "noop", "report", "solve"],
        }


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
        client.fail("job", "platform_fault", "", billable_ms=0)


def _clock(*readings_ns: int) -> Any:
    """A monotonic clock that returns the given readings in turn."""
    readings = iter(readings_ns)
    return lambda: next(readings)


def _claimed(api: FakeApi, client: ApiClient) -> ClaimedJob:
    api.enqueue("j1")
    job = client.claim(["noop"])
    assert job is not None
    return job


def test_reports_the_handlers_time_as_billable_milliseconds_rounded_up() -> None:
    with FakeApi() as api:
        client = client_for(settings_for(api))
        job = _claimed(api, client)
        clock = _clock(1_000_000_000, 3_500_000_001)
        assert run_job(client, job, HANDLERS, 0.01, clock=clock) == "succeeded"
        assert api.jobs["j1"]["outcome"]["metering"] == {"billableMs": 2501}


def test_reports_the_time_of_a_failed_job_too() -> None:
    def refused(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
        from clearfea_worker.jobs import JobFailure

        raise JobFailure("user_fault", "setup_invalid", "Add a support.")

    with FakeApi() as api:
        client = client_for(settings_for(api))
        job = _claimed(api, client)
        assert run_job(client, job, {"noop": refused}, 0.01, clock=_clock(0, 7_000_000)) == "failed"
        outcome = api.jobs["j1"]["outcome"]
        assert outcome["failureCategory"] == "user_fault"
        assert outcome["metering"] == {"billableMs": 7}


def test_measures_real_time_by_default() -> None:
    def busy(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
        threading.Event().wait(0.05)
        return {}

    with FakeApi() as api:
        client = client_for(settings_for(api))
        job = _claimed(api, client)
        run_job(client, job, {"noop": busy}, 0.01)
        assert 50 <= api.jobs["j1"]["outcome"]["metering"]["billableMs"] < 5000


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


def imported_block(tmp_path: Path) -> tuple[bytes, bytes]:
    step = block_with_hole(tmp_path / "block.step")
    import_geometry(step, tmp_path / "import", None)
    return step.read_bytes(), (tmp_path / "import" / "topology.json").read_bytes()


def mesh_params(size: dict[str, Any]) -> dict[str, Any]:
    return {"geometryId": "g1", "scaling": 1.0, "size": size, "order": 2}


def test_runs_a_mesh_job_through_its_transfer_urls(tmp_path: Path) -> None:
    step, topology = imported_block(tmp_path)
    with FakeApi() as api:
        api.enqueue(
            "j1",
            "mesh",
            params=mesh_params({"value": 8, "unit": "mm"}),
            downloads={"model.step": step, "topology.json": topology},
            uploads=("mesh.bin", "display.bin"),
        )
        settings = settings_for(api)
        assert run_once(client_for(settings), settings, HANDLERS) is True
        job = api.jobs["j1"]
        assert job["status"] == "succeeded", job.get("outcome")
        result = MeshResult.model_validate(job["outcome"]["result"])
        assert result.order == 2
        assert result.elements > 100
        assert api.uploads[("j1", "mesh.bin")][:4] == b"CFVM"
        assert api.uploads[("j1", "display.bin")][:4] == b"CFDM"


def test_a_mesh_size_that_is_far_too_small_is_the_users_fault(tmp_path: Path) -> None:
    step, topology = imported_block(tmp_path)
    with FakeApi() as api:
        api.enqueue(
            "j1",
            "mesh",
            params=mesh_params({"value": 0.01, "unit": "mm"}),
            downloads={"model.step": step, "topology.json": topology},
            uploads=("mesh.bin", "display.bin"),
        )
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "user_fault",
            "mesh_too_large",
        )
        assert "Enter a mesh size of at least" in outcome["failureMessage"]
        assert api.uploads == {}


def test_a_mesh_size_in_an_unknown_unit_is_a_platform_fault(tmp_path: Path) -> None:
    with FakeApi() as api:
        api.enqueue("j1", "mesh", params=mesh_params({"value": 1, "unit": "MPa"}))
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "platform_fault",
            "bad_params",
        )


SOLVE = Path(__file__).resolve().parent / "fixtures" / "solve"


def solve_job(
    api: FakeApi, tmp_path: Path, spec: dict[str, Any], machine: dict[str, Any] | None = None
) -> None:
    mesh_path = tmp_path / "mesh.bin"
    write_volume_mesh(mesh_path, two_tets(order=2))
    params: dict[str, Any] = {"meshId": "m1", "spec": spec}
    if machine is not None:
        params["machine"] = machine
    api.enqueue(
        "j1",
        "solve",
        params=params,
        downloads={"mesh.bin": mesh_path.read_bytes()},
        uploads=(
            "deck.inp",
            "solver.log",
            "results.frd",
            "results.dat",
            "surface.bin",
            "fields.bin",
            "nodes.bin",
        ),
    )


def fake_calculix(
    returncode: int = 0,
    lines: tuple[str, ...] = ("Job finished\n",),
    out_of_memory: bool = False,
    machines: list[Any] | None = None,
) -> Any:
    """Stands in for run_calculix: writes the fixture's output beside the deck, and keeps the
    simulated machine it was given in ``machines``."""

    def run(
        deck: Path, on_output: Any, cancelled: threading.Event, machine: Any = None
    ) -> SolverRun:
        if machines is not None:
            machines.append(machine)
        log = deck.with_name("solver.log")
        log.write_text("".join(lines))
        for line in lines:
            on_output(line)
        if out_of_memory:
            return SolverRun(None, log, out_of_memory=True)
        for suffix in (".frd", ".dat"):
            shutil.copy(SOLVE / f"job{suffix}", deck.with_suffix(suffix))
        return SolverRun(returncode, log)

    return run


@pytest.fixture
def no_calculix(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """The fast tier has no CalculiX: report a version and replace the solver run."""
    monkeypatch.setattr(versions, "calculix_version", lambda: "2.21")
    monkeypatch.setattr(solver, "run_calculix", fake_calculix())
    return monkeypatch


def test_runs_a_solve_job_and_streams_the_solver_log(tmp_path: Path, no_calculix: Any) -> None:
    lines = tuple(f"line {k}\n" for k in range(5))
    no_calculix.setattr(solver, "run_calculix", fake_calculix(lines=lines))
    with FakeApi() as api:
        solve_job(api, tmp_path, fixture_spec())
        settings = settings_for(api)
        assert run_once(client_for(settings), settings, HANDLERS) is True
        job = api.jobs["j1"]
        assert job["status"] == "succeeded", job.get("outcome")
        result = SolveResult.model_validate(job["outcome"]["result"])
        assert result.nodes == 14
        assert result.displacement.max.node == 4
        assert [r.support_id for r in result.reactions] == ["fixed-1"]
        # No yield strength: the summary leaves the safety factor out rather than sending null,
        # which the API's schema refuses (M3.5).
        assert "safetyFactor" not in job["outcome"]["result"]
        assert job["log"] == "".join(lines)
        deck = api.uploads[("j1", "deck.inp")].decode()
        assert deck == (SNAPSHOTS / "fixture-c3d10.inp").read_text()
        assert api.uploads[("j1", "solver.log")].decode() == "".join(lines)
        assert api.uploads[("j1", "results.frd")] == (SOLVE / "job.frd").read_bytes()
        assert api.uploads[("j1", "results.dat")] == (SOLVE / "job.dat").read_bytes()
        expected = tmp_path / "expected"
        expected.mkdir()
        nodal = read_fields(SOLVE / "job.frd", 14)
        files = write_viewer_files(two_tets(order=2), nodal, expected)
        assert api.uploads[("j1", "surface.bin")] == files.surface_path.read_bytes()
        assert api.uploads[("j1", "fields.bin")] == files.fields_path.read_bytes()
        assert api.uploads[("j1", "nodes.bin")] == files.nodes_path.read_bytes()


def test_a_setup_the_deck_cannot_use_is_the_users_fault(tmp_path: Path, no_calculix: Any) -> None:
    spec = fixture_spec()
    spec["supports"] = []
    with FakeApi() as api:
        solve_job(api, tmp_path, spec)
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "user_fault",
            "setup_invalid",
        )
        assert "Add a support" in outcome["failureMessage"]
        assert api.uploads == {}


def test_a_solver_error_is_a_platform_fault_and_keeps_deck_and_log(
    tmp_path: Path, no_calculix: Any
) -> None:
    lines = (" *ERROR reading *BOUNDARY: node set S9\n",)
    no_calculix.setattr(solver, "run_calculix", fake_calculix(returncode=201, lines=lines))
    with FakeApi() as api:
        solve_job(api, tmp_path, fixture_spec())
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "platform_fault",
            "solver_error",
        )
        assert "node set S9" in outcome["failureMessage"]
        assert set(api.uploads) == {("j1", "deck.inp"), ("j1", "solver.log")}


def test_the_solver_runs_on_the_jobs_simulated_machine(tmp_path: Path, no_calculix: Any) -> None:
    machines: list[Any] = []
    no_calculix.setattr(solver, "run_calculix", fake_calculix(machines=machines))
    machine = {"size": "small", "cores": 2, "memoryLimitBytes": 7301444403}
    with FakeApi() as api:
        solve_job(api, tmp_path, fixture_spec(), machine)
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        assert api.jobs["j1"]["status"] == "succeeded"
    [given] = machines
    assert (given.size, given.cores, given.memory_limit_bytes) == ("small", 2, 7301444403)


def test_a_solver_out_of_memory_keeps_deck_and_log_and_leaves_who_pays_to_the_api(
    tmp_path: Path, no_calculix: Any
) -> None:
    no_calculix.setattr(solver, "run_calculix", fake_calculix(out_of_memory=True))
    machine = {"size": "small", "cores": 2, "memoryLimitBytes": 7301444403}
    with FakeApi() as api:
        solve_job(api, tmp_path, fixture_spec(), machine)
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert (outcome["failureCategory"], outcome["failureCause"]) == (
            "platform_fault",
            "out_of_memory",
        )
        assert "6.8 GiB" in outcome["failureMessage"]
        assert set(api.uploads) == {("j1", "deck.inp"), ("j1", "solver.log")}


def test_a_missing_solver_is_a_platform_fault(tmp_path: Path, no_calculix: Any) -> None:
    no_calculix.setattr(versions, "calculix_version", lambda: None)
    with FakeApi() as api:
        solve_job(api, tmp_path, fixture_spec())
        settings = settings_for(api)
        run_once(client_for(settings), settings, HANDLERS)
        outcome = api.jobs["j1"]["outcome"]
        assert outcome["failureCause"] == "solver_missing"


def test_log_text_is_sent_in_chunks_the_schema_allows() -> None:
    context = JobContext()
    context.log("x" * (LOG_CHUNK_CHARS + 10))
    assert len(context.take_log()) == LOG_CHUNK_CHARS
    assert context.take_log() == "x" * 10
    assert not context.has_log()


def test_log_text_past_the_stream_limit_is_cut_with_one_note() -> None:
    context = JobContext()
    context.log("x" * (LOG_STREAM_CHARS - 1))
    context.log("yy")
    context.log("zz")
    text = ""
    while context.has_log():
        text += context.take_log()
    assert text == "x" * (LOG_STREAM_CHARS - 1) + "y" + LOG_CUT_NOTE
