# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class UnitDefinition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    factor: Annotated[float, Field(gt=0.0)]
    offset: float | None = None
    definition: str
    """
    Where the factor comes from, so a reviewer can check it.
    """


class QuantityKind(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    description: str | None = None
    si: str
    """
    The SI unit stored and solved in. It must appear in units with factor 1 and offset 0.
    """
    units: Annotated[dict[str, UnitDefinition], Field(min_length=1)]


class UnitsTable(BaseModel):
    """
    Shape of packages/spec/units.json, the single table of quantity kinds and allowed units. A value in unit u converts to SI as value * factor + offset.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Annotated[int, Field(ge=1)]
    kinds: dict[str, QuantityKind]
