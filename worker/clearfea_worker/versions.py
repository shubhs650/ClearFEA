# SPDX-License-Identifier: AGPL-3.0-or-later
"""Versions of the worker and its solvers, recorded so runs can state what produced them."""

import os
import re
import shutil
import subprocess
from collections.abc import Mapping
from importlib import metadata

from . import __version__
from .deck.generator import DECK_FORMAT
from .spec.jobs_schema import WorkerSoftware

#: The source commit the worker image was built from, set by its Docker build (ADR-032).
COMMIT_VARIABLE = "CLEARFEA_COMMIT"


def calculix_version(executable: str = "ccx") -> str | None:
    """Returns the CalculiX version, for example '2.21', or None if ccx is not found."""
    path = shutil.which(executable)
    if path is None:
        return None
    completed = subprocess.run(
        [path, "-v"], capture_output=True, text=True, timeout=30, check=False
    )
    match = re.search(r"Version\s+(\S+)", completed.stdout + completed.stderr)
    return match.group(1) if match else None


def gmsh_version() -> str | None:
    """Returns the installed Gmsh Python package version without loading its library."""
    try:
        return metadata.version("gmsh")
    except metadata.PackageNotFoundError:
        return None


def gmsh_loads() -> tuple[bool, str]:
    """Loads and initialises Gmsh. Returns whether it worked and a detail line."""
    try:
        import gmsh
    except OSError as error:  # the shared library or one of its system libraries is missing
        return False, f"Gmsh's library failed to load: {error}"
    gmsh.initialize(readConfigFiles=False)
    try:
        return True, f"Gmsh {gmsh.option.getString('General.Version')} initialised"
    finally:
        gmsh.finalize()


def clearfea_version(env: Mapping[str, str] | None = None) -> str:
    """The package version, with the source commit after a + when the build recorded one."""
    env = os.environ if env is None else env
    commit = env.get(COMMIT_VARIABLE, "").strip()[:40]
    return f"{__version__}+{commit}" if commit else __version__


def worker_software(env: Mapping[str, str] | None = None) -> WorkerSoftware:
    """The versions the worker reports when it claims a job."""
    return WorkerSoftware(
        clearfea=clearfea_version(env),
        deck_format=DECK_FORMAT,
        calculix=calculix_version(),
        gmsh=gmsh_version(),
    )
