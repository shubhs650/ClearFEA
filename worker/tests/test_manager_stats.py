# SPDX-License-Identifier: AGPL-3.0-or-later
"""What the compute manager measures for support (M12.3, ADR-109, ADR-123): job containers'
statistics and the host's load."""

from pathlib import Path
from typing import Any

import pytest

from clearfea_worker.manager.stats import (
    SAMPLE_SECONDS,
    ContainerSampler,
    cpu_shares,
    host_load,
)

from .fake_api import FakeApi
from .test_manager import FakeDocker, started


def sample(
    second: int, cpu_s: float, memory: int, cache: int = 0, written: int | None = None
) -> dict[str, Any]:
    """Docker's statistics of a container on cgroup v2, `second` seconds after 10:00."""
    stats: dict[str, Any] = {
        "read": f"2026-10-22T10:00:{second:02d}.000000000Z",
        "cpu_stats": {"cpu_usage": {"total_usage": int(cpu_s * 1e9)}, "online_cpus": 8},
        "memory_stats": {"usage": memory, "stats": {"inactive_file": cache}},
        "blkio_stats": {"io_service_bytes_recursive": None},
    }
    if written is not None:
        stats["blkio_stats"]["io_service_bytes_recursive"] = [
            {"major": 8, "minor": 0, "op": "read", "value": 999},
            {"major": 8, "minor": 0, "op": "write", "value": written},
        ]
    return stats


def test_a_containers_samples_give_its_peak_memory_cpu_and_disk() -> None:
    sampler = ContainerSampler()
    assert sampler.figures() == {"samples": 0}
    sampler.add(None)
    sampler.add({"read": "0001-01-01T00:00:00Z", "memory_stats": {}, "cpu_stats": {}})
    sampler.add(sample(0, 1.0, 600, cache=100))
    sampler.add(sample(5, 31.0, 2000, cache=500, written=4096))  # six CPUs busy
    sampler.add(sample(10, 41.0, 900, written=8192))  # two
    assert sampler.figures() == {
        "samples": 3,
        "peak_memory_bytes": 1500,
        "cpu_seconds": 41.0,
        "cpu_peak": 6.0,
        "disk_written_bytes": 8192,
    }


def test_cgroup_v1_statistics_are_read_too() -> None:
    sampler = ContainerSampler()
    stats = sample(0, 2.0, 1000)
    stats["memory_stats"] = {"usage": 1000, "stats": {"total_inactive_file": 400}}
    stats["blkio_stats"] = {"io_service_bytes_recursive": [{"op": "Write", "value": 77}]}
    sampler.add(stats)
    assert sampler.figures()["peak_memory_bytes"] == 600
    assert sampler.figures()["disk_written_bytes"] == 77
    assert "cpu_peak" in sampler.figures()


def write_proc(proc: Path, cpu: tuple[int, ...]) -> None:
    proc.mkdir(exist_ok=True)
    (proc / "stat").write_text("cpu  " + " ".join(map(str, cpu)) + " 0 0\ncpu0 1 2 3\n")
    (proc / "loadavg").write_text("6.10 5.20 4.00 3/400 12345\n")
    (proc / "meminfo").write_text(
        "MemTotal:       25165824 kB\nMemFree:  1000 kB\nMemAvailable:    6291456 kB\n"
    )


def test_the_hosts_load_comes_from_proc(tmp_path: Path) -> None:
    proc = tmp_path / "proc"
    write_proc(proc, (100, 0, 50, 800, 10, 0, 0, 40))
    first, times = host_load(proc, tmp_path, containers=3, previous=None)
    assert first.cpu is None and first.steal is None
    assert (first.load1, first.load5, first.load15) == (6.1, 5.2, 4.0)
    assert first.memory_total_bytes == 24 * 1024**3
    assert first.memory_available_bytes == 6 * 1024**3
    assert first.disk_total_bytes > 0 and first.containers == 3
    # 1000 ticks later: 600 busy, 50 of them stolen; idle and I/O wait 400.
    write_proc(proc, (500, 0, 200, 1100, 110, 0, 0, 90))
    second, _ = host_load(proc, tmp_path, containers=3, previous=times)
    assert (second.cpu, second.steal) == (0.6, 0.05)
    assert cpu_shares(times, times) is None


def test_a_job_containers_statistics_are_sampled_and_sent_when_it_ends() -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, clock = started(api, docker)
        manager.tick()  # claims s1 and starts its container
        container = docker.jobs()["s1"]
        container["Stats"] = sample(0, 1.0, 10 * 2**30)
        manager.tick()  # first sample
        container["Stats"] = sample(5, 31.0, 12 * 2**30, written=2**20)
        manager.tick()  # too soon for another
        clock.now += SAMPLE_SECONDS
        manager.tick()
        docker.exit(container["Id"], 0)
        manager.tick()
    [(job_id, body)] = api.container_stats
    assert job_id == "s1"
    assert body == {
        "workerId": "vps1-solve",
        "host": "vps1",
        "lane": "solve",
        "image": "clearfea-worker",
        "exitCode": 0,
        "outOfMemory": False,
        "runMs": 2500,
        "samples": 2,
        "peakMemoryBytes": 12 * 2**30,
        "cpuSeconds": 31.0,
        "cpuPeak": 6.0,
        "diskWrittenBytes": 2**20,
    }


@pytest.mark.parametrize("oom", [False, True])
def test_a_killed_container_is_sent_with_its_exit_code(oom: bool) -> None:
    docker = FakeDocker()
    with FakeApi() as api:
        api.enqueue("m1", "mesh")
        manager, _ = started(api, docker)
        manager.tick()
        docker.exit(docker.jobs()["m1"]["Id"], 137, oom=oom)
        manager.tick()
    [(_, body)] = api.container_stats
    assert (body["workerId"], body["lane"], body["exitCode"], body["outOfMemory"]) == (
        "vps1-light",
        "light",
        137,
        oom,
    )
    assert body["samples"] == 0 and "peakMemoryBytes" not in body


def test_a_container_that_never_started_is_sent_without_an_exit_code() -> None:
    docker = FakeDocker()
    docker.fail_create = True
    with FakeApi() as api:
        api.enqueue("s1", "solve")
        manager, _ = started(api, docker)
        manager.tick()
    [(_, body)] = api.container_stats
    assert (body["exitCode"], body["runMs"], body["samples"]) == (None, 0, 0)
    assert body["image"].startswith("sha256:")


def test_check_ins_carry_the_hosts_load(tmp_path: Path) -> None:
    proc = tmp_path / "proc"
    write_proc(proc, (100, 0, 50, 800, 10, 0, 0, 40))
    docker = FakeDocker()
    with FakeApi() as api:
        manager, clock = started(api, docker, disk_path=str(tmp_path))
        manager.proc = proc
        manager.tick()
        write_proc(proc, (500, 0, 200, 1100, 110, 0, 0, 90))
        clock.now += 30
        manager.tick()
        manager.proc = tmp_path / "missing"
        clock.now += 30
        manager.tick()
    check_ins = [body for path, body in api.calls if path.endswith("/check-in")]
    assert check_ins[0]["load"]["load1"] == 6.1 and "cpu" not in check_ins[0]["load"]
    assert (check_ins[1]["load"]["cpu"], check_ins[1]["load"]["steal"]) == (0.6, 0.05)
    # Without its load the host still checks in.
    assert "load" not in check_ins[2] and check_ins[2]["host"] == "vps1"
