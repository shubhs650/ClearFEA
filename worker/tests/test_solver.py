# SPDX-License-Identifier: AGPL-3.0-or-later
"""Solver supervision, with small scripts standing in for CalculiX."""

import sys
import threading
import time
from pathlib import Path

from clearfea_worker.solver import run_calculix, solver_environment


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


def test_spooles_runs_on_one_thread_whatever_the_environment_says(tmp_path: Path) -> None:
    ccx = fake_solver(
        tmp_path, 'import os\nprint(os.environ.get("CCX_NPROC_EQUATION_SOLVER"), flush=True)'
    )
    lines: list[str] = []
    run_calculix(deck(tmp_path), lines.append, threading.Event(), executable=ccx)
    assert lines == ["1\n"]
    env = solver_environment({"CCX_NPROC_EQUATION_SOLVER": "4", "OMP_NUM_THREADS": "4"})
    assert env == {"CCX_NPROC_EQUATION_SOLVER": "1", "OMP_NUM_THREADS": "4"}
