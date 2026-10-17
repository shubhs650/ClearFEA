# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs CalculiX on a deck as a supervised child process and passes its output on (ADR-030).

The solver's console output is the run's log: each line goes to ``on_output`` as it is
written, so the API can stream it, and the whole log is kept in ``solver.log`` beside the
deck. A crash of the solver ends only the child process, never the worker.

On one physical machine a run's machine size is simulated (M8.5, ADR-081): the solver is held
to the size's cores and stopped as out of memory when its resident memory passes the size's
usable memory, as the kernel would stop it on a real machine of that size.
"""

import os
import shutil
import signal
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .spec.simulation_schema import SimulatedMachine

#: How often the supervisor checks for a cancellation, and the solver's memory, while it runs.
POLL_SECONDS = 0.1
#: How long a cancelled solver may take to stop before it is killed.
TERMINATE_SECONDS = 5.0


def solver_environment(base: dict[str, str] | None = None) -> dict[str, str]:
    """CalculiX's environment: one thread for everything, whatever else is set (ADR-048,
    ADR-063).

    ccx 2.21's multithreaded SPOOLES (CCX_NPROC_EQUATION_SOLVER, or OMP_NUM_THREADS when that
    is unset) now and then returns a wrong solution: solved 20 times on 4 threads, two of the
    support check's decks (elastic support, turned support) came out off by up to 240 and 25
    percent of their largest value, and V-07 and V-24 once failed make verify by up to 200
    percent, while every single-threaded solve was identical (M2.11). PaStiX's own OpenMP loops
    follow OMP_NUM_THREADS; left unset, OpenMP starts a thread per core that spins against
    PaStiX's single worker, which cost 8 to 14 s on a 3,000-element mesh (ADR-063). So
    OMP_NUM_THREADS is 1 too: a run takes the same time on every machine size (ADR-049).
    """
    env = dict(os.environ if base is None else base)
    env["CCX_NPROC_EQUATION_SOLVER"] = "1"
    env["OMP_NUM_THREADS"] = "1"
    return env


@dataclass(frozen=True)
class SolverRun:
    """How a solver process ended. ``returncode`` is None when it was cancelled.
    ``peak_memory_bytes`` is the largest resident memory seen, None where it cannot be read."""

    returncode: int | None
    log_path: Path
    out_of_memory: bool = False
    peak_memory_bytes: int | None = None

    @property
    def cancelled(self) -> bool:
        return self.returncode is None and not self.out_of_memory

    def errors(self) -> list[str]:
        """CalculiX's ``*ERROR`` lines, which it prints for every fatal problem."""
        text = self.log_path.read_text(encoding="utf-8", errors="replace")
        return [line.strip() for line in text.splitlines() if "*ERROR" in line]


def solver_command(deck: Path, executable: str = "ccx") -> list[str]:
    """``ccx -i <name>``, line-buffered through ``stdbuf`` when it is available, so the log
    arrives line by line instead of in blocks of a pipe buffer."""
    command = [executable, "-i", deck.stem]
    stdbuf = shutil.which("stdbuf")
    return [stdbuf, "-oL", "-eL", *command] if stdbuf else command


def resident_bytes(pid: int) -> int | None:
    """The process's resident memory, from /proc; None where there is no /proc or no process."""
    try:
        pages = int(Path(f"/proc/{pid}/statm").read_text().split()[1])
    except (OSError, IndexError, ValueError):
        return None
    return pages * os.sysconf("SC_PAGE_SIZE")


def hold_to_cores(pid: int, cores: int) -> None:
    """Lets the process run on ``cores`` of the processors the worker may use, the first ones;
    on all of them when it has fewer. The solver itself stays on one thread (ADR-048, ADR-063),
    so this changes no run's time; it keeps the simulated size honest about its processors."""
    if not hasattr(os, "sched_setaffinity"):
        return
    available = sorted(os.sched_getaffinity(0))
    if cores < len(available):
        try:
            os.sched_setaffinity(pid, available[:cores])
        except OSError:
            pass  # The solver ended already.


def killed_by_kernel(returncode: int) -> bool:
    """A solver killed outright by SIGKILL that the worker did not send: on Linux the kernel's
    out-of-memory killer, when the real machine (or the container) runs out before the limit."""
    return returncode == -signal.SIGKILL


def run_calculix(
    deck: Path,
    on_output: Callable[[str], None],
    cancelled: threading.Event,
    executable: str = "ccx",
    machine: SimulatedMachine | None = None,
) -> SolverRun:
    """Solves ``deck`` (a ``.inp`` file) in its own directory; results land beside it. With a
    ``machine``, the solver runs on its cores and is killed once its resident memory passes the
    machine's limit, which the result reports as ``out_of_memory``."""
    log_path = deck.with_name("solver.log")
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            solver_command(deck, executable),
            cwd=deck.parent,
            stdin=subprocess.DEVNULL,
            env=solver_environment(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        def pump() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                on_output(line)

        reader = threading.Thread(target=pump, daemon=True)
        reader.start()
        if machine is not None:
            hold_to_cores(process.pid, machine.cores)
        peak: int | None = None
        out_of_memory = False
        while True:
            try:
                returncode: int | None = process.wait(timeout=POLL_SECONDS)
                break
            except subprocess.TimeoutExpired:
                resident = resident_bytes(process.pid)
                if resident is not None:
                    peak = max(peak or 0, resident)
                limit = None if machine is None else machine.memory_limit_bytes
                if resident is not None and limit is not None and resident > limit:
                    # As the kernel would on a machine of this size: no warning, no clean-up.
                    process.kill()
                    process.wait()
                    out_of_memory = True
                    returncode = None
                    break
                if cancelled.is_set():
                    process.terminate()
                    try:
                        process.wait(timeout=TERMINATE_SECONDS)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    returncode = None
                    break
        reader.join()
    if returncode is not None and killed_by_kernel(returncode):
        out_of_memory, returncode = True, None
    return SolverRun(returncode, log_path, out_of_memory, peak)
