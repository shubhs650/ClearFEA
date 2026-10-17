# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Storage = Annotated[Any, Field(title="Storage")]
"""
Wire shapes of the storage route (M8.6, ADR-085; docs/ARCHITECTURE.md section 4). Sizes are in bytes; money is in whole micro-credits (1,000,000 is one credit). Each message is a definition under $defs.
"""


type StorageKind = Literal["geometry", "mesh", "results", "rawOutput", "report"]
"""
What stored files are: geometry (the STEP file, topology and display mesh), mesh (volume and display meshes), results (a run's solver input, log and viewer files, kept permanently), rawOutput (a run's results.frd and results.dat, kept for the retention period unless the run is pinned), report (reports, report figures and the report logo).
"""


class StoragePart(BaseModel):
    """
    The bytes and number of files of one kind.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: StorageKind
    bytes: Annotated[int, Field(ge=0)]
    files: Annotated[int, Field(ge=0)]


class StorageRun(BaseModel):
    """
    A run that holds raw solver output, with its size and what happens to it.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    simulation_id: Annotated[str, Field(alias="simulationId")]
    simulation_name: Annotated[str, Field(alias="simulationName")]
    started_at: Annotated[str, Field(alias="startedAt")]
    bytes: Annotated[int, Field(ge=0)]
    pinned: bool
    kept_until: Annotated[str | None, Field(alias="keptUntil")]
    """
    When the retention period ends; null when the run is pinned.
    """


class StorageView(BaseModel):
    """
    The signed-in user's storage: every file kept for them, by kind, against the free allowance, and the runs that hold raw solver output, newest first. The daily sweep removes raw output past its retention period and charges the bytes above the allowance at the rate per GiB per day.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    used_bytes: Annotated[int, Field(alias="usedBytes", ge=0)]
    free_bytes: Annotated[int, Field(alias="freeBytes", ge=0)]
    """
    The free allowance.
    """
    rate_per_gib_day: Annotated[int, Field(alias="ratePerGibDay", ge=0)]
    """
    Micro-credits per GiB per day stored above the allowance.
    """
    retention_days: Annotated[int, Field(alias="retentionDays", ge=0)]
    """
    Days raw solver output is kept after a run ends unless the run is pinned.
    """
    parts: list[StoragePart]
    """
    One entry per kind, in the order of StorageKind.
    """
    runs: list[StorageRun]


class StorageResponse(BaseModel):
    """
    Answer to GET /api/storage.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    storage: StorageView
