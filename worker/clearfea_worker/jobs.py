# SPDX-License-Identifier: AGPL-3.0-or-later
"""Job handlers, one per job type."""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from .api import ClaimedJob
from .spec.jobs_schema import FailureCategory

if TYPE_CHECKING:
    from .api import ApiClient


class JobFailure(Exception):
    """A handler's reason for failing a job: who is at fault, a cause code and what to do."""

    def __init__(self, category: FailureCategory, cause: str, message: str) -> None:
        super().__init__(message)
        self.category = category
        self.cause = cause
        self.message = message


@dataclass
class Files:
    """The job's transfer URLs (ADR-005), used by name."""

    job: ClaimedJob
    client: "ApiClient"
    workdir: Path

    def _url(self, name: str, direction: str) -> str:
        for transfer in self.job.transfers:
            if transfer.name == name and transfer.direction == direction:
                return transfer.url
        raise JobFailure(
            "platform_fault", "transfer_missing", f"The API gave no {direction} URL for {name}."
        )

    def download(self, name: str) -> Path:
        path = self.workdir / name
        self.client.download(self._url(name, "download"), path)
        return path

    def upload(self, name: str, path: Path) -> None:
        self.client.upload(self._url(name, "upload"), path)


#: Most log text one heartbeat carries (HeartbeatRequest.log in jobs.schema.json).
LOG_CHUNK_CHARS = 65536
#: Most log text a job streams to the API; the full log is uploaded as a file.
LOG_STREAM_CHARS = 1_000_000
LOG_CUT_NOTE = "\n[The log is too long to show here; the full log is kept with the run.]\n"


@dataclass
class JobContext:
    """What a handler may use while it runs."""

    stage: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    files: Files | None = None
    _log: list[str] = field(default_factory=list)
    _logged: int = 0
    _log_lock: threading.Lock = field(default_factory=threading.Lock)

    def set_stage(self, stage: str) -> None:
        self.stage = stage

    def log(self, text: str) -> None:
        """Queues log text for the next heartbeat. Past LOG_STREAM_CHARS, adds one note
        and drops the rest."""
        with self._log_lock:
            room = LOG_STREAM_CHARS - self._logged
            if room <= 0:
                return
            if len(text) > room:
                self._log.append(text[:room] + LOG_CUT_NOTE)
                self._logged = LOG_STREAM_CHARS
            else:
                self._log.append(text)
                self._logged += len(text)

    def take_log(self, limit: int = LOG_CHUNK_CHARS) -> str:
        """Removes and returns up to ``limit`` characters of queued log text."""
        with self._log_lock:
            text = "".join(self._log)
            self._log = [text[limit:]] if len(text) > limit else []
            return text[:limit]

    def has_log(self) -> bool:
        with self._log_lock:
            return any(self._log)

    def unread_log(self, text: str) -> None:
        """Puts back text that could not be sent, ahead of anything queued since."""
        if text:
            with self._log_lock:
                self._log.insert(0, text)

    def require_files(self) -> Files:
        if self.files is None:
            raise RuntimeError("This job was started without file transfers.")
        return self.files


Handler = Callable[[ClaimedJob, JobContext], dict[str, Any]]


def run_noop(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
    """Does nothing. Exists to prove the claim, heartbeat and completion path."""
    context.set_stage("noop")
    return {"message": "No-op job completed."}


def run_import(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
    """Imports an uploaded STEP file: topology.json and display.bin (M1.2)."""
    from .geometry.importer import ImportFailure, import_geometry
    from .spec.geometry_schema import ImportParams

    try:
        params = ImportParams.model_validate(job.params or {})
    except ValidationError as error:
        raise JobFailure("platform_fault", "bad_params", f"Import parameters: {error}") from None
    files = context.require_files()
    context.set_stage("downloading")
    step = files.download("model.step")
    context.set_stage("importing")
    try:
        output = import_geometry(step, files.workdir / "out", params.confirmed_unit)
    except ImportFailure as failure:
        raise JobFailure("user_fault", failure.cause, failure.message) from None
    context.set_stage("uploading")
    files.upload("topology.json", output.topology_path)
    files.upload("display.bin", output.display_path)
    return output.result.model_dump(mode="json", by_alias=True)


def run_mesh(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
    """Meshes a geometry with a global size (M1.6) and local sizes (M2.8): mesh.bin and the
    mesh's display.bin."""
    from .meshing.mesher import LocalSize, MeshFailure, mesh_geometry
    from .spec.geometry_schema import Topology
    from .spec.simulation_schema import MeshParams
    from .units import UnitError, to_si

    try:
        params = MeshParams.model_validate(job.params or {})
        size = to_si(params.size.value, params.size.unit, "length")
        local = tuple(
            LocalSize(
                scope=item.scope,
                tags=tuple(item.tags),
                size=to_si(item.size.value, item.size.unit, "length"),
                text=f"{item.size.value:g} {item.size.unit}",
            )
            for item in params.local or []
        )
    except (ValidationError, UnitError) as error:
        raise JobFailure("platform_fault", "bad_params", f"Mesh parameters: {error}") from None
    files = context.require_files()
    context.set_stage("downloading")
    step = files.download("model.step")
    try:
        reference = Topology.model_validate_json(files.download("topology.json").read_bytes())
    except ValidationError as error:
        raise JobFailure("platform_fault", "bad_topology", f"topology.json: {error}") from None
    context.set_stage("meshing")
    try:
        output = mesh_geometry(
            step,
            reference,
            files.workdir / "out",
            scaling=params.scaling,
            size=size,
            unit=params.size.unit,
            order=params.order,
            local=local,
        )
    except MeshFailure as failure:
        raise JobFailure(failure.category, failure.cause, failure.message) from None
    context.set_stage("uploading")
    files.upload("mesh.bin", output.mesh_path)
    files.upload("display.bin", output.display_path)
    return output.result.model_dump(mode="json", by_alias=True)


def run_solve(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
    """Solves a run: deck from the frozen spec and the mesh, CalculiX, results (M1.8), and the
    viewer's surface and field files (M1.9)."""
    from .deck import DeckError, generate_deck
    from .meshing.volume import read_volume_mesh
    from .results import DatError, FrdError, read_results, write_viewer_files
    from .solver import run_calculix
    from .spec.simulation_schema import SolveParams
    from .versions import calculix_version

    try:
        params = SolveParams.model_validate(job.params or {})
    except ValidationError as error:
        raise JobFailure("platform_fault", "bad_params", f"Solve parameters: {error}") from None
    calculix = calculix_version()
    if calculix is None:
        raise JobFailure("platform_fault", "solver_missing", "CalculiX (ccx) is not installed.")
    files = context.require_files()
    context.set_stage("downloading")
    try:
        mesh = read_volume_mesh(files.download("mesh.bin"))
    except ValueError as error:
        raise JobFailure("platform_fault", "bad_mesh", f"mesh.bin: {error}") from None
    context.set_stage("writing input")
    try:
        deck_text = generate_deck(params.spec, mesh)
    except DeckError as error:
        raise JobFailure("user_fault", "setup_invalid", str(error)) from None
    work = files.workdir / "solve"
    work.mkdir()
    deck = work / "job.inp"
    deck.write_text(deck_text, encoding="utf-8")
    context.set_stage("solving")
    run = run_calculix(deck, context.log, context.cancelled)
    if run.cancelled:
        return {}
    context.set_stage("uploading")
    files.upload("deck.inp", deck)
    files.upload("solver.log", run.log_path)
    errors = run.errors()
    if run.returncode != 0 or errors:
        detail = errors[0] if errors else f"exit status {run.returncode}"
        raise JobFailure(
            "platform_fault", "solver_error", f"CalculiX stopped on the deck: {detail}"
        )
    context.set_stage("reading results")
    frd, dat = work / "job.frd", work / "job.dat"
    try:
        fields, result = read_results(params.spec, mesh, frd, dat, calculix)
    except (OSError, FrdError, DatError) as error:
        raise JobFailure("platform_fault", "results_unreadable", str(error)) from None
    context.set_stage("writing result files")
    viewer = write_viewer_files(mesh, fields, work)
    context.set_stage("uploading")
    files.upload("results.frd", frd)
    files.upload("results.dat", dat)
    files.upload("surface.bin", viewer.surface_path)
    files.upload("fields.bin", viewer.fields_path)
    return result.model_dump(mode="json", by_alias=True)


HANDLERS: dict[str, Handler] = {
    "noop": run_noop,
    "import": run_import,
    "mesh": run_mesh,
    "solve": run_solve,
}
