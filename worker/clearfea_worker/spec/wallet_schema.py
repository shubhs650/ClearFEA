# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Wallet = Annotated[Any, Field(title="Wallet")]
"""
Wire shapes of the wallet route (M8.1, ADR-080; docs/ARCHITECTURE.md sections 4 and 6). Money is in whole micro-credits: 1,000,000 is one credit. Each message is a definition under $defs.
"""


type LedgerReason = Literal["grant", "mesh", "solve", "storage"]
"""
What a ledger entry is for: a play-money credit grant, the charge for a mesh or solve job (ADR-033), or a day's charge for storage above the free allowance (M8.6, ADR-085).
"""


class LedgerJob(BaseModel):
    """
    The job a charge is for: the machine size and rate it was queued with and the seconds billed (ADR-033).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    machine_size: Annotated[str, Field(alias="machineSize")]
    rate_per_hour: Annotated[int, Field(alias="ratePerHour", ge=0)]
    """
    Micro-credits per hour of billable time.
    """
    billed_seconds: Annotated[int, Field(alias="billedSeconds", ge=0)]


class LedgerRun(BaseModel):
    """
    The run a solve charge paid for.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    simulation_id: Annotated[str, Field(alias="simulationId")]
    simulation_name: Annotated[str, Field(alias="simulationName")]
    started_at: Annotated[str, Field(alias="startedAt")]
    status: Literal["solving", "succeeded", "failed"]


class LedgerMesh(BaseModel):
    """
    The mesh a mesh charge paid for. A mesh belongs to a geometry and may serve several simulations (ADR-047), so it is named by its geometry. Counts are null when meshing failed.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    geometry_name: Annotated[str, Field(alias="geometryName")]
    elements: Annotated[int | None, Field(ge=0)]
    nodes: Annotated[int | None, Field(ge=0)]


class LedgerStorage(BaseModel):
    """
    What a storage charge was for (M8.6, ADR-085): the UTC day, the bytes the user stored when the daily sweep measured them, the free allowance then, and the rate per GiB per day above it.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    day: str
    """
    YYYY-MM-DD, UTC.
    """
    used_bytes: Annotated[int, Field(alias="usedBytes", ge=0)]
    free_bytes: Annotated[int, Field(alias="freeBytes", ge=0)]
    rate_per_gib_day: Annotated[int, Field(alias="ratePerGibDay", ge=0)]
    """
    Micro-credits per GiB per day stored above the allowance.
    """


class WalletEntry(BaseModel):
    """
    One ledger entry, as the append-only ledger holds it, with what it paid for. amount is negative for a charge; balance is the balance after the entry. job, run, mesh and storage are null where they do not apply.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    seq: Annotated[int, Field(ge=1)]
    created_at: Annotated[str, Field(alias="createdAt")]
    reason: LedgerReason
    amount: int
    balance: int
    job: LedgerJob | None
    run: LedgerRun | None
    mesh: LedgerMesh | None
    storage: LedgerStorage | None


class WalletView(BaseModel):
    """
    The signed-in user's wallet: the balance (the last entry's balance, 0 with no entries), what was granted and charged in all, and every ledger entry, newest first. granted + charged equals balance.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    balance: int
    granted: Annotated[int, Field(ge=0)]
    charged: Annotated[int, Field(le=0)]
    """
    The sum of the charges, zero or negative.
    """
    entries: list[WalletEntry]


class WalletResponse(BaseModel):
    """
    Answer to GET /api/wallet.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    wallet: WalletView
    self_hosted: Annotated[bool, Field(alias="selfHosted")]
    """
    True in self-hosting mode (M8.10, ADR-084): jobs are still metered and charged to the ledger, but the wallet is informational and a balance refuses no run or mesh.
    """
