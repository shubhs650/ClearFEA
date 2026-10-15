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


@dataclass
class JobContext:
    """What a handler may use while it runs."""

    stage: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    files: Files | None = None

    def set_stage(self, stage: str) -> None:
        self.stage = stage

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
    """Meshes a geometry with a global size: mesh.bin and the mesh's display.bin (M1.6)."""
    from .meshing.mesher import MeshFailure, mesh_geometry
    from .spec.geometry_schema import Topology
    from .spec.simulation_schema import MeshParams
    from .units import UnitError, to_si

    try:
        params = MeshParams.model_validate(job.params or {})
        size = to_si(params.size.value, params.size.unit, "length")
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
        )
    except MeshFailure as failure:
        raise JobFailure(failure.category, failure.cause, failure.message) from None
    context.set_stage("uploading")
    files.upload("mesh.bin", output.mesh_path)
    files.upload("display.bin", output.display_path)
    return output.result.model_dump(mode="json", by_alias=True)


HANDLERS: dict[str, Handler] = {
    "noop": run_noop,
    "import": run_import,
    "mesh": run_mesh,
}
