# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

type Project = Annotated[Any, Field(title="Project")]
"""
Wire shapes of the project and folder routes (docs/ARCHITECTURE.md section 4, ADR-038, ADR-114, ADR-124). Each user has projects, at the top of their home or in folders; a deleted project or folder goes to the trash and is purged after the trash retention period. Times are ISO 8601 UTC. Each message is a definition under $defs.
"""


type Name = Annotated[str, Field(max_length=120, min_length=1)]
"""
A project or folder name. Spaces at either end are removed; an empty name is refused.
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
    folder_id: Annotated[str | None, Field(alias="folderId")]
    """
    The folder holding the project; null at the top of the home.
    """
    deleted_at: Annotated[str | None, Field(alias="deletedAt")]
    """
    When the project went to the trash; null outside it.
    """
    last_opened_at: Annotated[str | None, Field(alias="lastOpenedAt")]
    thumbnail_at: Annotated[str | None, Field(alias="thumbnailAt")]
    """
    When the viewer last stored the project's thumbnail; null for none.
    """
    created_at: Annotated[str, Field(alias="createdAt")]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class FolderView(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: str
    parent_id: Annotated[str | None, Field(alias="parentId")]
    """
    The folder holding this one; null at the top of the home.
    """
    deleted_at: Annotated[str | None, Field(alias="deletedAt")]
    """
    When the folder went to the trash; null outside it.
    """
    created_at: Annotated[str, Field(alias="createdAt")]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class ProjectResponse(BaseModel):
    """
    Answer to GET and PATCH /api/project, and to the routes under /api/projects that act on one project.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    project: ProjectView


class FolderResponse(BaseModel):
    """
    Answer to the routes under /api/folders that act on one folder.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    folder: FolderView


class HomeResponse(BaseModel):
    """
    Answer to GET /api/projects: every folder and project of the user, those in the trash included (deletedAt set). An item in the trash is shown at the top of the trash when its folder is outside the trash or went there at a different time; the rest went with that folder and come back with it. Each is purged trashRetentionDays after its deletedAt.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    folders: list[FolderView]
    projects: list[ProjectView]
    trash_retention_days: Annotated[int, Field(alias="trashRetentionDays", ge=0)]


class ProjectUpdate(BaseModel):
    """
    Body of PATCH /api/project. The unit system must be one units.json lists.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    unit_system: Annotated[str, Field(alias="unitSystem", max_length=50, min_length=1)]


class ProjectCreate(BaseModel):
    """
    Body of POST /api/projects: a new, empty project, at the top of the home (folderId null or left out) or in a folder outside the trash.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Name
    folder_id: Annotated[str | None, Field(alias="folderId")] = None


class ProjectChange(BaseModel):
    """
    Body of PATCH /api/projects/{id}: rename it, move it (folderId null for the top of the home), or set its unit system. At least one; a project in the trash is restored first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Name | None = None
    folder_id: Annotated[str | None, Field(alias="folderId")] = None
    unit_system: Annotated[str | None, Field(alias="unitSystem", max_length=50, min_length=1)] = (
        None
    )


class FolderCreate(BaseModel):
    """
    Body of POST /api/folders: a new folder at the top of the home (parentId null or left out) or inside a folder outside the trash.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Name
    parent_id: Annotated[str | None, Field(alias="parentId")] = None


class FolderChange(BaseModel):
    """
    Body of PATCH /api/folders/{id}: rename it or move it (parentId null for the top of the home, never into itself or a folder inside it). At least one; a folder in the trash is restored first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Name | None = None
    parent_id: Annotated[str | None, Field(alias="parentId")] = None


class DuplicateRequest(BaseModel):
    """
    Body of POST /api/projects/{id}/duplicate and POST /api/folders/{id}/duplicate, which may be empty: the copy's name (default: the original's with " (copy)") and where it goes (default: beside the original). The copy holds the geometries and simulation setups, not meshes, runs or reports.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Name | None = None
    folder_id: Annotated[str | None, Field(alias="folderId")] = None
