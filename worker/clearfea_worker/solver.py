# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs CalculiX on a deck as a supervised child process and passes its output on (ADR-030).

The solver's console output is the run's log: each line goes to ``on_output`` as it is
written, so the API can stream it, and the whole log is kept in ``solver.log`` beside the
deck. A crash of the solver ends only the child process, never the worker.
"""

import shutil
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

#: How often the supervisor checks for a cancellation while the solver runs.
POLL_SECONDS = 0.5
#: How long a cancelled solver may take to stop before it is killed.
TERMINATE_SECONDS = 5.0


@dataclass(frozen=True)
class SolverRun:
    """How a solver process ended. ``returncode`` is None when it was cancelled."""

    returncode: int | None
    log_path: Path

    @property
    def cancelled(self) -> bool:
        return self.returncode is None

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


def run_calculix(
    deck: Path,
    on_output: Callable[[str], None],
    cancelled: threading.Event,
    executable: str = "ccx",
) -> SolverRun:
    """Solves ``deck`` (a ``.inp`` file) in its own directory; results land beside it."""
    log_path = deck.with_name("solver.log")
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            solver_command(deck, executable),
            cwd=deck.parent,
            stdin=subprocess.DEVNULL,
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
        while True:
            try:
                returncode: int | None = process.wait(timeout=POLL_SECONDS)
                break
            except subprocess.TimeoutExpired:
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
    return SolverRun(returncode, log_path)
