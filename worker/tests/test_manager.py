# SPDX-License-Identifier: AGPL-3.0-or-later
"""The compute manager (M12.1, ADR-107) against a stand-in Docker daemon and the fake API."""

import json
import struct
from dataclasses import replace
from typing import Any

import pytest

from clearfea_worker.__main__ import main
from clearfea_worker.api import ClaimedJob
from clearfea_worker.config import ConfigError, Settings
from clearfea_worker.manager.config import (
    DEFAULT_LIGHT,
    DEFAULT_SOLVE,
    ManagerSettings,
    load_manager_settings,
    parse_memory,
)
from clearfea_worker.manager.containers import (
    HOST_LABEL,
    JOB_LABEL,
    JOB_TYPE_LABEL,
    JOB_VARIABLE,
    LANE_LABEL,
    JobTooLarge,
    container_spec,
    decode_job,
    docker_time,
    encode_job,
)
from clearfea_worker.manager.docker import DockerError, demux_logs
from clearfea_worker.manager.manager import IMAGE_RETRY_SECONDS, Manager, _Clocks

from .fake_api import FakeApi

SOFTWARE = {"clearfea": "0.0.0+abc1234", "deckFormat": 5, "calculix": "2.21", "gmsh": "4.15.2"}
STARTED = "2026-10-22T10:00:00.000000000Z"


class FakeDocker:
    """The Engine API calls the manager makes, on containers held in memory."""

    def __init__(self) -> None:
        self.images = {"clearfea-worker": "sha256:" + "a" * 64}
        self.containers_by_id: dict[str, dict[str, Any]] = {}
        self.volumes: set[str] = set()
        self.killed: list[str] = []
        self.fail_create = False
        self.software_output = json.dumps(SOFTWARE)
        self._next = 0

    def info(self) -> dict[str, Any]:
        return {"NCPU": 8, "MemTotal": 24 * 1024**3, "ServerVersion": "29.0.0"}

    def image_id(self, name: str) -> str | None:
        return self.images.get(name)

    def create_volume(self, name: str, labels: dict[str, str]) -> None:
        self.volumes.add(name)

    def remove_volume(self, name: str) -> None:
        self.volumes.discard(name)

    def create_container(self, name: str, spec: dict[str, Any]) -> str:
        if self.fail_create and spec["Cmd"] == ["job"]:
            raise DockerError("Docker answered 500 on POST /containers/create: no space", 500)
        self._next += 1
        cid = f"{self._next:064x}"
        self.containers_by_id[cid] = {
            "Id": cid,
            "Name": name,
            "Spec": spec,
            "Labels": spec.get("Labels", {}),
            "State": {
                "Status": "created",
                "ExitCode": 0,
                "OOMKilled": False,
                "StartedAt": "0001-01-01T00:00:00Z",
                "FinishedAt": "0001-01-01T00:00:00Z",
            },
        }
        return cid

    def start(self, container: str) -> None:
        state = self.containers_by_id[container]["State"]
        state.update(Status="running", StartedAt=STARTED)

    def inspect(self, container: str) -> dict[str, Any] | None:
        return self.containers_by_id.get(container)

    def wait(self, container: str, timeout: float) -> int:
        record = self.containers_by_id[container]
        if record["Spec"]["Cmd"] == ["software"]:
            self.exit(container, 0)
        return record["State"]["ExitCode"]

    def kill(self, container: str) -> None:
        self.killed.append(container)
        self.exit(container, 137)

    def remove(self, container: str) -> None:
        self.containers_by_id.pop(container, None)
        for cid, record in list(self.containers_by_id.items()):
            if record["Name"] == container:
                del self.containers_by_id[cid]

    def logs(self, container: str, tail: int = 50) -> str:
        record = self.containers_by_id[container]
        if record["Spec"]["Cmd"] == ["software"]:
            return self.software_output + "\n"
        return "Running job\n"

    def containers(self, label: str) -> list[dict[str, Any]]:
        name, value = label.split("=", 1)
        return [
            {"Id": cid, "Labels": r["Labels"], "State": r["State"]["Status"]}
            for cid, r in self.containers_by_id.items()
            if r["Labels"].get(name) == value
        ]

    # For the tests ---------------------------------------------------------------------------

    def exit(self, container: str, code: int, oom: bool = False) -> None:
        self.containers_by_id[container]["State"].update(
            Status="exited", ExitCode=code, OOMKilled=oom, FinishedAt="2026-10-22T10:00:02.5Z"
        )

    def jobs(self) -> dict[str, dict[str, Any]]:
        """Job containers by job id."""
        return {
            r["Labels"][JOB_LABEL]: r
            for r in self.containers_by_id.values()
            if JOB_LABEL in r["Labels"]
        }


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def manager_settings(api: FakeApi, **changes: Any) -> ManagerSettings:
    worker = Settings(api_url=api.url, worker_token="t", worker_id="unused", poll_seconds=2.0)
    settings = ManagerSettings(
        worker=worker, host="vps1", image="clearfea-worker", lanes=(DEFAULT_SOLVE, DEFAULT_LIGHT)
    )
    return replace(settings, **changes)


def started(api: FakeApi, docker: FakeDocker, **changes: Any) -> tuple[Manager, Clock]:
    clock = Clock()
    # Docker's clock: two seconds after the containers started.
    manager = Manager(
        manager_settings(api, **changes), docker, clocks=_Clocks(clock, lambda: 1792663202.0)
    )
    manager.start()
    return manager, clock


def claims(api: FakeApi) -> list[dict[str, Any]]:
    return [body for path, body in api.calls if path.endswith("/claim")]


def outcomes(api: FakeApi) -> list[tuple[str, dict[str, Any]]]:
    return [(path.split("/")[3], body) for path, body in api.calls if path.endswith("/complete")]


# The job container -----------------------------------------------------------------------------


def a_job(job_id: str = "j1", job_type: str = "solve", params: Any = None) -> ClaimedJob:
    return ClaimedJob.model_validate(
        {"id": job_id, "type": job_type, "targetId": None, "params": params, "transfers": []}
    )


def test_a_job_container_is_hardened() -> None:
    with FakeApi() as api:
        settings = manager_settings(api)
    spec = container_spec(settings, DEFAULT_SOLVE, a_job(), "sha256:abc", host_cpus=8)
    host = spec["HostConfig"]
    assert spec["User"] == "10001:10001"
    assert spec["Cmd"] == ["job"]
    assert host["CapDrop"] == ["ALL"]
    assert host["SecurityOpt"] == ["no-new-privileges:true"]
    assert host["ReadonlyRootfs"] is True
    assert host["Memory"] == host["MemorySwap"] == 17 * 1024**3
    assert host["PidsLimit"] == 1024
    assert host["NanoCpus"] == 6 * 10**9
    assert host["NetworkMode"] == "bridge"
    assert host["Mounts"] == [{"Type": "volume", "Source": "clearfea-job-j1", "Target": "/scratch"}]
    # Nothing of the host's: no Docker socket, no bind mounts, no published ports, no privileges.
    assert "Binds" not in host and "PortBindings" not in host and not host.get("Privileged")
    env = dict(item.split("=", 1) for item in spec["Env"])
    assert env["CLEARFEA_WORKER_ID"] == "vps1-solve"
    assert env["TMPDIR"] == "/scratch"
    assert decode_job(env[JOB_VARIABLE]).id == "j1"
    assert "CLEARFEA_ACCESS_CLIENT_ID" not in env
    assert spec["Labels"] == {
        HOST_LABEL: "vps1",
        LANE_LABEL: "solve",
        JOB_LABEL: "j1",
        JOB_TYPE_LABEL: "solve",
    }


def test_a_lane_is_pinned_to_its_cpus_or_held_to_what_the_host_has() -> None:
    with FakeApi() as api:
        settings = manager_settings(api, network="host")
    pinned = replace(DEFAULT_SOLVE, cpuset="0-5")
    host = container_spec(settings, pinned, a_job(), "i", host_cpus=8)["HostConfig"]
    assert host["CpusetCpus"] == "0-5" and "NanoCpus" not in host
    small = container_spec(settings, DEFAULT_SOLVE, a_job(), "i", host_cpus=4)["HostConfig"]
    assert small["NanoCpus"] == 4 * 10**9
    assert "ExtraHosts" not in small


def test_the_access_token_goes_into_the_job_container() -> None:
    with FakeApi() as api:
        settings = manager_settings(api)
    worker = replace(settings.worker, access_client_id="id", access_client_secret="secret")
    spec = container_spec(replace(settings, worker=worker), DEFAULT_LIGHT, a_job(), "i", 8)
    env = dict(item.split("=", 1) for item in spec["Env"])
    assert (env["CLEARFEA_ACCESS_CLIENT_ID"], env["CLEARFEA_ACCESS_CLIENT_SECRET"]) == (
        "id",
        "secret",
    )
    assert env["CLEARFEA_WORKER_ID"] == "vps1-light"


def test_a_job_too_large_for_the_environment_is_refused() -> None:
    assert decode_job(encode_job(a_job(params={"a": [1, 2, 3]}))).params == {"a": [1, 2, 3]}
    noise = {f"k{i}": f"{i * 7919:x}" * 40 for i in range(20000)}
    with pytest.raises(JobTooLarge):
        encode_job(a_job(params=noise))


def test_docker_times_and_logs_are_read() -> None:
    assert docker_time("0001-01-01T00:00:00Z") is None
    assert docker_time(STARTED) == 1792663200.0
    assert docker_time("2026-10-22T10:00:00.5+00:00") == 1792663200.5
    framed = b"".join(
        struct.pack(">BxxxI", stream, len(text)) + text for stream, text in ((1, b"a\n"), (2, b"b"))
    )
    assert demux_logs(framed) == "a\nb"
    assert demux_logs(b"plain text") == "plain text"


# Settings --------------------------------------------------------------------------------------


def test_the_lanes_start_at_adr_107s_values_and_can_be_changed() -> None:
    settings = load_manager_settings({"CLEARFEA_WORKER_TOKEN": "t", "CLEARFEA_HOST_NAME": "vps1"})
    solve, light = settings.lanes
    assert (solve.name, solve.job_types, solve.cpus, solve.memory_bytes) == (
        "solve",
        ("solve",),
        6.0,
        17 * 1024**3,
    )
    assert (light.name, light.cpus, light.memory_bytes) == ("light", 1.0, 4 * 1024**3)
    assert set(light.job_types) == {"noop", "import", "mesh", "report"}
    assert settings.network == "bridge" and settings.image == "clearfea-worker"

    changed = load_manager_settings(
        {
            "CLEARFEA_WORKER_TOKEN": "t",
            "CLEARFEA_SOLVE_CPUSET": "0-5",
            "CLEARFEA_LIGHT_MEMORY": "2048m",
            "CLEARFEA_LIGHT_CPUS": "0.5",
            "CLEARFEA_JOB_NETWORK": "host",
        }
    )
    assert changed.lanes[0].cpuset == "0-5"
    assert changed.lanes[1].memory_bytes == 2 * 1024**3 and changed.lanes[1].cpus == 0.5
    assert changed.network == "host"


@pytest.mark.parametrize(
    "env",
    [
        {"CLEARFEA_HOST_NAME": "my host"},
        {"CLEARFEA_SOLVE_CPUSET": "zero"},
        {"CLEARFEA_LIGHT_MEMORY": "lots"},
        {"CLEARFEA_SOLVE_CPUS": "-1"},
    ],
)
def test_bad_manager_settings_are_refused(env: dict[str, str]) -> None:
    with pytest.raises(ConfigError):
        load_manager_settings({"CLEARFEA_WORKER_TOKEN": "t", **env})


def test_memory_amounts() -> None:
    assert parse_memory("x", "17g") == 17 * 1024**3
    assert parse_memory("x", "4GiB") == 4 * 1024**3
    assert parse_memory("x", "1048576") == 1024**2


# The manager -----------------------------------------------------------------------------------


def test_each_lane_claims_its_job_types_under_its_own_worker_id() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("m1", "mesh")
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker)
        manager.tick()
    claims = [body for path, body in api.calls if path.endswith("/claim")]
    assert [(c["workerId"], c["jobTypes"]) for c in claims] == [
        ("vps1-solve", ["solve"]),
        ("vps1-light", ["noop", "import", "mesh", "report"]),
    ]
    # The claim names the software of the image that runs the job, read from the image itself.
    assert all(c["software"] == SOFTWARE for c in claims)
    jobs = docker.jobs()
    assert set(jobs) == {"m1", "s1"}
    assert all(r["State"]["Status"] == "running" for r in jobs.values())
    assert docker.volumes == {"clearfea-job-m1", "clearfea-job-s1"}
    # Only the job containers are left: the software check's container is gone.
    assert len(docker.containers_by_id) == 2


def test_a_busy_lane_claims_nothing_and_a_free_one_claims_again() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker)
        manager.tick()
        api.enqueue("s2", "solve")
        api.calls.clear()
        manager.tick()
        assert not any(
            body["workerId"] == "vps1-solve" for path, body in api.calls if "claim" in path
        )
        docker.exit(docker.jobs()["s1"]["Id"], 0)
        manager.tick()  # clears s1 up
        manager.tick()  # claims s2
    assert set(docker.jobs()) == {"s2"}
    assert docker.volumes == {"clearfea-job-s2"}
    # The container reported s1 itself; the manager adds nothing.
    assert outcomes(api) == []


@pytest.mark.parametrize(("oom", "cause"), [(False, "container_exited"), (True, "out_of_memory")])
def test_a_container_that_ends_without_reporting_fails_its_job(oom: bool, cause: str) -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker)
        manager.tick()
        docker.exit(docker.jobs()["s1"]["Id"], 137, oom=oom)
        manager.tick()
    [(job_id, body)] = outcomes(api)
    assert job_id == "s1"
    assert body["workerId"] == "vps1-solve"
    assert (body["status"], body["failureCategory"], body["failureCause"]) == (
        "failed",
        "platform_fault",
        cause,
    )
    assert body["metering"] == {"billableMs": 2500}
    assert docker.jobs() == {} and docker.volumes == set()


def test_a_container_past_its_time_limit_is_killed_and_its_job_failed() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker, job_max_seconds=1.0)
        manager.tick()  # claims; Docker's clock is 2 s after the start
        manager.tick()  # kills
        assert len(docker.killed) == 1
        manager.tick()  # reports
    [(_, body)] = outcomes(api)
    assert body["failureCause"] == "job_timeout"


def test_a_restarted_manager_follows_running_containers_and_clears_up_ended_ones() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        api.enqueue("m1", "mesh")
        first, _ = started(api, docker)
        first.tick()
        docker.exit(docker.jobs()["m1"]["Id"], 137)
        api.enqueue("s2", "solve")
        api.calls.clear()

        second, _ = started(api, docker)
        assert [s.job_id for s in second.lanes] == ["s1", None]
        assert [job_id for job_id, _ in outcomes(api)] == ["m1"]
        second.tick()
        # The solve lane still runs s1 and claims nothing; the light lane asks again.
        assert [b["workerId"] for p, b in api.calls if p.endswith("/claim")] == ["vps1-light"]
    assert set(docker.jobs()) == {"s1"}


def test_a_missing_image_claims_nothing() -> None:
    docker = FakeDocker()
    docker.images.clear()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, clock = started(api, docker)
        manager.tick()
        assert all(s.next_claim == clock.now + IMAGE_RETRY_SECONDS for s in manager.lanes)
    assert claims(api) == []


def test_an_image_that_cannot_report_its_software_claims_nothing() -> None:
    docker = FakeDocker()
    docker.software_output = "Traceback: something broke"
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker)
        manager.tick()
    assert claims(api) == []
    assert docker.containers_by_id == {}


def test_a_container_that_cannot_be_created_fails_its_job_uncharged() -> None:
    docker = FakeDocker()
    docker.fail_create = True
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, clock = started(api, docker)
        manager.tick()
        assert manager.lanes[0].next_claim == clock.now + IMAGE_RETRY_SECONDS
    [(_, body)] = outcomes(api)
    assert body["failureCause"] == "container_start_failed"
    assert body["metering"] == {"billableMs": 0}
    assert docker.volumes == set()


def test_the_host_checks_in_at_start_and_when_the_api_says(  # M12.4, ADR-120
) -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        manager, clock = started(api, docker)
        manager.tick()
        manager.tick()
        clock.now += 30
        manager.tick()
    check_ins = [body for path, body in api.calls if path.endswith("/hosts/check-in")]
    assert len(check_ins) == 2
    assert check_ins[0]["host"] == "vps1" and check_ins[0]["managerVersion"]


def test_an_idle_lane_asks_less_often_up_to_its_limit() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        manager, clock = started(api, docker)
        pauses = []
        for _ in range(6):
            clock.now = manager.lanes[0].next_claim
            before = clock.now
            manager.tick()
            pauses.append(manager.lanes[0].next_claim - before)
    assert pauses == [2.0, 4.0, 8.0, 15.0, 15.0, 15.0]


def test_the_job_command_runs_the_one_job_it_is_given(monkeypatch: pytest.MonkeyPatch) -> None:
    with FakeApi() as api:
        api.enqueue("n1", "noop")
        api.queue.clear()  # claimed by the manager
        api.jobs["n1"]["status"] = "claimed"
        monkeypatch.setenv("CLEARFEA_API_URL", api.url)
        monkeypatch.setenv("CLEARFEA_WORKER_TOKEN", "t")
        monkeypatch.setenv("CLEARFEA_WORKER_ID", "vps1-light")
        monkeypatch.setenv("CLEARFEA_HEARTBEAT_SECONDS", "0.05")
        monkeypatch.setenv(JOB_VARIABLE, encode_job(a_job("n1", "noop")))
        assert main(["job"]) == 0
    assert api.jobs["n1"]["status"] == "succeeded"
    assert {body["workerId"] for _, body in api.calls} == {"vps1-light"}
    assert not any(path.endswith("/claim") for path, _ in api.calls)


def test_the_job_command_needs_a_job(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLEARFEA_WORKER_TOKEN", "t")
    monkeypatch.delenv(JOB_VARIABLE, raising=False)
    assert main(["job"]) == 2


def test_the_software_command_prints_what_a_claim_reports(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["software"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert set(printed) >= {"clearfea", "deckFormat", "calculix", "gmsh"}
