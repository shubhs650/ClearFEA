# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

type Project = Annotated[Any, Field(title="Project")]
"""
Wire shapes of the project routes (docs/ARCHITECTURE.md section 4, ADR-038). In Phase 0 each user has one project, created when first asked for. Each message is a definition under $defs.
"""


class ProjectView(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: str
    unit_system: Annotated[str, Field(alias="unitSystem")]
    """
    Id of a unit system in packages/spec/units.json: the unit every quantity field offers first and the unit results are shown in.
    """


class ProjectResponse(BaseModel):
    """
    Answer to GET /api/project and PATCH /api/project.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    project: ProjectView


class ProjectUpdate(BaseModel):
    """
    Body of PATCH /api/project. The unit system must be one units.json lists.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    unit_system: Annotated[str, Field(alias="unitSystem", max_length=50, min_length=1)]
