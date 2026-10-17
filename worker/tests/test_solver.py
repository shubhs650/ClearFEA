# SPDX-License-Identifier: AGPL-3.0-or-later
"""Solver supervision, with small scripts standing in for CalculiX."""

import os
import sys
import threading
import time
from pathlib import Path

import pytest

from clearfea_worker.solver import resident_bytes, run_calculix, solver_environment
from clearfea_worker.spec.simulation_schema import SimulatedMachine


def fake_solver(tmp_path: Path, body: str) -> str:
    """An executable that runs ``body`` as Python with the job name in ``name``."""
    script = tmp_path / "fake-ccx"
    script.write_text(
        f"#!{sys.executable}\nimport sys, time\nname = sys.argv[2]\n{body}\n", encoding="utf-8"
    )
    script.chmod(0o755)
    return str(script)


def deck(tmp_path: Path) -> Path:
    work = tmp_path / "solve"
    work.mkdir()
    path = work / "job.inp"
    path.write_text("*HEADING\n")
    return path


def test_passes_each_line_on_and_keeps_the_whole_log(tmp_path: Path) -> None:
    ccx = fake_solver(
        tmp_path,
        'print("one", flush=True)\nprint("*ERROR in two", flush=True)\n'
        'open(name + ".frd", "w").write("x")\nsys.exit(3)',
    )
    lines: list[str] = []
    run = run_calculix(deck(tmp_path), lines.append, threading.Event(), executable=ccx)
    assert run.returncode == 3
    assert not run.cancelled
    assert lines == ["one\n", "*ERROR in two\n"]
    assert run.log_path.read_text() == "one\n*ERROR in two\n"
    assert run.errors() == ["*ERROR in two"]
    assert (run.log_path.parent / "job.frd").read_text() == "x"


def test_lines_arrive_while_the_solver_runs(tmp_path: Path) -> None:
    ccx = fake_solver(tmp_path, 'print("started")\nsys.stdout.flush()\ntime.sleep(2)')
    started = time.monotonic()
    arrived: list[float] = []

    def output(line: str) -> None:
        arrived.append(time.monotonic() - started)

    run = run_calculix(deck(tmp_path), output, threading.Event(), executable=ccx)
    assert run.returncode == 0
    assert arrived and arrived[0] < 1.5


def test_a_cancel_stops_the_solver(tmp_path: Path) -> None:
    ccx = fake_solver(tmp_path, 'print("working", flush=True)\ntime.sleep(60)')
    cancelled = threading.Event()

    def output(line: str) -> None:
        cancelled.set()

    started = time.monotonic()
    run = run_calculix(deck(tmp_path), output, cancelled, executable=ccx)
    assert run.cancelled
    assert time.monotonic() - started < 10


def test_the_solver_runs_on_one_thread_whatever_the_environment_says(tmp_path: Path) -> None:
    ccx = fake_solver(
        tmp_path,
        "import os\n"
        'print(os.environ.get("CCX_NPROC_EQUATION_SOLVER"), os.environ.get("OMP_NUM_THREADS"), '
        "flush=True)",
    )
    lines: list[str] = []
    run_calculix(deck(tmp_path), lines.append, threading.Event(), executable=ccx)
    assert lines == ["1 1\n"]
    env = solver_environment({"CCX_NPROC_EQUATION_SOLVER": "4", "OMP_NUM_THREADS": "4"})
    assert env == {"CCX_NPROC_EQUATION_SOLVER": "1", "OMP_NUM_THREADS": "1"}


needs_proc = pytest.mark.skipif(resident_bytes(os.getpid()) is None, reason="needs /proc")

#: Resident memory the memory test's stand-in grows to, far past its limit.
GROWS_TO = 400 * 2**20


@needs_proc
def test_a_solver_past_its_machines_memory_is_stopped_as_out_of_memory(tmp_path: Path) -> None:
    # Grows its resident memory 20 MiB at a time, then would sleep long past the test.
    ccx = fake_solver(
        tmp_path,
        "held = []\n"
        f"for _ in range({GROWS_TO // (20 * 2**20)}):\n"
        "    held.append(bytearray(20 * 2**20))\n"
        "    time.sleep(0.05)\n"
        'print("never", flush=True)\ntime.sleep(60)',
    )
    machine = SimulatedMachine(size="tiny", cores=1, memoryLimitBytes=100 * 2**20)
    started = time.monotonic()
    run = run_calculix(deck(tmp_path), lambda line: None, threading.Event(), ccx, machine)
    assert run.out_of_memory
    assert not run.cancelled
    assert run.returncode is None
    assert run.peak_memory_bytes is not None and run.peak_memory_bytes > 100 * 2**20
    assert time.monotonic() - started < 10


@needs_proc
def test_a_solver_within_its_machines_memory_runs_to_the_end(tmp_path: Path) -> None:
    ccx = fake_solver(tmp_path, "held = bytearray(20 * 2**20)\ntime.sleep(0.5)\nsys.exit(0)")
    machine = SimulatedMachine(size="tiny", cores=1, memoryLimitBytes=200 * 2**20)
    run = run_calculix(deck(tmp_path), lambda line: None, threading.Event(), ccx, machine)
    assert (run.returncode, run.out_of_memory) == (0, False)
    assert run.peak_memory_bytes is not None and run.peak_memory_bytes > 20 * 2**20


@pytest.mark.skipif(not hasattr(os, "sched_getaffinity"), reason="needs processor affinity")
def test_the_solver_runs_on_its_machines_cores(tmp_path: Path) -> None:
    available = len(os.sched_getaffinity(0))
    lines: list[str] = []
    # Sleep first so the affinity is set before the stand-in reads it.
    ccx = fake_solver(
        tmp_path, "import os\ntime.sleep(0.5)\nprint(len(os.sched_getaffinity(0)), flush=True)"
    )
    machine = SimulatedMachine(size="one", cores=1, memoryLimitBytes=2**40)
    path = deck(tmp_path)
    run_calculix(path, lines.append, threading.Event(), ccx, machine)
    assert lines == ["1\n"]
    lines.clear()
    wide = SimulatedMachine(size="wide", cores=available + 8, memoryLimitBytes=2**40)
    run_calculix(path, lines.append, threading.Event(), ccx, wide)
    assert lines == [f"{available}\n"]
