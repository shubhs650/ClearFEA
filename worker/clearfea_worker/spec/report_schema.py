# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Report = Annotated[Any, Field(title="Report")]
"""
Report options (M7.1, ADR-074): what a simulation's report prints (its sections, the saved views drawn as result plots, the title block) and the user's own company name and logo, which every report of theirs carries. The report job (M7.3) reads them, with the figures captured in the browser for a run (M7.2, ADR-011). Text is printed as typed. Each message is a definition under $defs.
"""


type ReportSection = Literal[
    "project",
    "geometry",
    "materials",
    "mesh",
    "loadsSupports",
    "solver",
    "results",
    "reactions",
    "extremes",
    "warnings",
]
"""
A section the report can print, from DECISIONS.md's Report row: project and revision, geometry and units, materials, mesh statistics, each load and support with a picture, solver settings and versions, result plots, the reaction (or heat) balance check, minimum and maximum tables, run warnings. The standing statements (M7.5) are always printed and are not a section.
"""


type ReportText = Annotated[str, Field(max_length=200)]
"""
One line of the title block or the company name, printed as typed; may be empty.
"""


class TitleBlock(BaseModel):
    """
    The title block printed on the cover and in every page header. Empty fields are left out.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    title: ReportText
    document_number: Annotated[ReportText, Field(alias="documentNumber")]
    revision: ReportText
    prepared_by: Annotated[ReportText, Field(alias="preparedBy")]
    checked_by: Annotated[ReportText, Field(alias="checkedBy")]
    approved_by: Annotated[ReportText, Field(alias="approvedBy")]


class ReportOptions(BaseModel):
    """
    Body of PUT /api/simulations/:id/report-options. Sections are printed in the order of ReportSection whatever order they are listed in; views (ids of the simulation's saved views, ADR-055) are drawn as result plots in the order listed.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    sections: list[ReportSection]
    views: list[str]
    title_block: Annotated[TitleBlock, Field(alias="titleBlock")]
    unit_system: Annotated[str, Field(alias="unitSystem", max_length=50, min_length=1)]
    """
    Id of the unit system in packages/spec/units.json that every value of the report prints in (M7.6, ADR-076), whatever the browser's result view shows. Starts as the project's unit system; an id the table no longer lists is answered as the project's.
    """


class ReportOptionsResponse(BaseModel):
    """
    Answer to GET and PUT /api/simulations/:id/report-options. Until options are saved the answer holds the defaults (every section, no views, the simulation's name as the title, the project's unit system) with saved false. Views deleted since are left out.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    options: ReportOptions
    saved: bool
    updated_at: Annotated[str | None, Field(alias="updatedAt")]


class ReportLogo(BaseModel):
    """
    The user's logo: a PNG or JPEG image, its size in bytes and in pixels. The image itself is GET /api/report-branding/logo.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    content_type: Annotated[Literal["image/png", "image/jpeg"], Field(alias="contentType")]
    size_bytes: Annotated[int, Field(alias="sizeBytes", ge=1)]
    width: Annotated[int, Field(ge=1)]
    height: Annotated[int, Field(ge=1)]
    updated_at: Annotated[str, Field(alias="updatedAt")]


class ReportBranding(BaseModel):
    """
    The company name and logo every report of the user carries, set once per user.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    company_name: Annotated[ReportText, Field(alias="companyName")]
    logo: ReportLogo | None


class SaveReportBrandingRequest(BaseModel):
    """
    Body of PUT /api/report-branding. The logo is sent on its own to POST /api/report-branding/logo.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    company_name: Annotated[ReportText, Field(alias="companyName")]


class ReportBrandingResponse(BaseModel):
    """
    Answer to the /api/report-branding routes.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    branding: ReportBranding


type ReportFigureKind = Literal["support", "load", "view"]
"""
What a report figure shows (M7.2): one support or one load of the run's setup, drawn on the geometry with its faces picked out, or one saved view of the simulation drawn as saved (a result plot, or the geometry for a view saved without results).
"""


class ReportFigure(BaseModel):
    """
    A figure captured in the browser for a run's report (M7.2, ADR-011): a PNG drawn by the same viewer the user sees. kind and item name what it shows: a support or load by its id in the run's frozen setup, or a saved view by its id. The image is GET /api/runs/:id/figures/:kind/:item.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: ReportFigureKind
    item: Annotated[str, Field(pattern="^[A-Za-z0-9_-]{1,64}$")]
    caption: ReportText
    """
    The caption printed under the figure, as captured.
    """
    position: Annotated[int, Field(ge=0, le=999)]
    """
    Where the figure comes among the run's figures, from 0.
    """
    width: Annotated[int, Field(ge=1)]
    height: Annotated[int, Field(ge=1)]
    size_bytes: Annotated[int, Field(alias="sizeBytes", ge=1)]
    created_at: Annotated[str, Field(alias="createdAt")]


class ReportFigureResponse(BaseModel):
    """
    Answer to PUT /api/runs/:id/figures/:kind/:item, which takes the PNG as the body and the caption and position in the query.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    figure: ReportFigure


class ReportFigureListResponse(BaseModel):
    """
    Answer to GET and DELETE /api/runs/:id/figures: the run's figures in order of position (none after a DELETE).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    figures: list[ReportFigure]
