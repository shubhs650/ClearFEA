# SPDX-License-Identifier: AGPL-3.0-or-later
"""What the compute manager measures for support (M12.3, ADR-109, ADR-123): each job container's
memory, CPU and disk from Docker's statistics, and the host's load from /proc. Pure functions of
what Docker and /proc answer, so they are tested without either."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..spec.jobs_schema import HostLoad
from .containers import docker_time

#: Seconds between two samples of a running job container's statistics.
SAMPLE_SECONDS = 5.0


def _memory_in_use(memory: dict[str, Any]) -> int | None:
    """Memory in use as `docker stats` shows it: the cgroup's usage less the page cache the
    kernel can drop at once (inactive_file on cgroup v2, total_inactive_file on v1)."""
    usage = memory.get("usage")
    if not isinstance(usage, int):
        return None
    detail = memory.get("stats") or {}
    cache = detail.get("inactive_file", detail.get("total_inactive_file", 0))
    return max(0, usage - (cache if isinstance(cache, int) else 0))


def _bytes_written(blkio: dict[str, Any] | None) -> int | None:
    """Bytes written to block devices, summed over devices (op "write" on cgroup v2, "Write" on
    v1); None when Docker reports none."""
    entries = (blkio or {}).get("io_service_bytes_recursive")
    if not entries:
        return None
    return sum(int(e.get("value", 0)) for e in entries if str(e.get("op", "")).lower() == "write")


@dataclass
class ContainerSampler:
    """Running figures of one job container from its statistics samples."""

    samples: int = 0
    peak_memory_bytes: int = 0
    cpu_ns: int = 0
    cpu_peak: float = 0.0
    disk_written_bytes: int | None = None
    _last_cpu_ns: int | None = None
    _last_read: float | None = None

    def add(self, stats: dict[str, Any] | None) -> None:
        """Takes one sample. A stopped container's statistics are empty and are passed over."""
        if not stats:
            return
        memory = _memory_in_use(stats.get("memory_stats") or {})
        cpu = ((stats.get("cpu_stats") or {}).get("cpu_usage") or {}).get("total_usage")
        read = docker_time(stats.get("read"))
        if memory is None or not isinstance(cpu, int) or read is None:
            return
        self.samples += 1
        self.peak_memory_bytes = max(self.peak_memory_bytes, memory)
        if self._last_cpu_ns is not None and self._last_read is not None:
            seconds = read - self._last_read
            if seconds > 0:
                busy = (cpu - self._last_cpu_ns) / 1e9 / seconds
                self.cpu_peak = max(self.cpu_peak, round(busy, 3))
        self.cpu_ns = max(self.cpu_ns, cpu)
        self._last_cpu_ns, self._last_read = cpu, read
        written = _bytes_written(stats.get("blkio_stats"))
        if written is not None:
            self.disk_written_bytes = max(self.disk_written_bytes or 0, written)

    def figures(self) -> dict[str, Any]:
        """The ContainerStats fields measured, by their Python names; none without a sample."""
        if self.samples == 0:
            return {"samples": 0}
        figures: dict[str, Any] = {
            "samples": self.samples,
            "peak_memory_bytes": self.peak_memory_bytes,
            "cpu_seconds": round(self.cpu_ns / 1e9, 3),
            "cpu_peak": self.cpu_peak,
        }
        if self.disk_written_bytes is not None:
            figures["disk_written_bytes"] = self.disk_written_bytes
        return figures


#: Fields of /proc/stat's "cpu" line, in clock ticks: user nice system idle iowait irq softirq
#: steal (guest time is counted in user already).
CpuTimes = tuple[int, ...]


def read_cpu_times(proc: Path) -> CpuTimes:
    first = (proc / "stat").read_text().splitlines()[0].split()
    return tuple(int(v) for v in first[1:9])


def cpu_shares(previous: CpuTimes | None, current: CpuTimes) -> tuple[float, float] | None:
    """The busy and stolen shares of the host's CPU time between two readings, or None
    without a previous reading or with no time between them."""
    if previous is None:
        return None
    delta = [c - p for c, p in zip(current, previous, strict=True)]
    total = sum(delta)
    if total <= 0:
        return None
    idle = delta[3] + delta[4]
    steal = delta[7] if len(delta) > 7 else 0
    return round(max(0.0, min(1.0, (total - idle) / total)), 4), round(
        max(0.0, min(1.0, steal / total)), 4
    )


def _meminfo(proc: Path) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in (proc / "meminfo").read_text().splitlines():
        name, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[name] = int(parts[0]) * (1024 if len(parts) > 1 and parts[1] == "kB" else 1)
    return values


def host_load(
    proc: Path,
    disk: Path,
    containers: int,
    previous: CpuTimes | None,
) -> tuple[HostLoad, CpuTimes]:
    """The host's load for a check-in, and this reading of its CPU times for the next one. Inside
    a container /proc/stat, /proc/loadavg and /proc/meminfo are still the host's."""
    times = read_cpu_times(proc)
    shares = cpu_shares(previous, times)
    load1, load5, load15 = (float(v) for v in (proc / "loadavg").read_text().split()[:3])
    memory = _meminfo(proc)
    disk_stat = os.statvfs(disk)
    extra: dict[str, float] = {} if shares is None else {"cpu": shares[0], "steal": shares[1]}
    load = HostLoad(
        load1=load1,
        load5=load5,
        load15=load15,
        memory_total_bytes=memory.get("MemTotal", 0),
        memory_available_bytes=memory.get("MemAvailable", 0),
        disk_total_bytes=disk_stat.f_blocks * disk_stat.f_frsize,
        disk_free_bytes=disk_stat.f_bavail * disk_stat.f_frsize,
        containers=max(0, containers),
        **extra,
    )
    return load, times
