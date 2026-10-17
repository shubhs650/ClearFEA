# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Report = Annotated[Any, Field(title="Report")]
"""
Report options (M7.1, ADR-073): what a simulation's report prints (its sections, the saved views drawn as result plots, the title block) and the user's own company name and logo, which every report of theirs carries. The report job (M7.3) reads them. Text is printed as typed. Each message is a definition under $defs.
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


class ReportOptionsResponse(BaseModel):
    """
    Answer to GET and PUT /api/simulations/:id/report-options. Until options are saved the answer holds the defaults (every section, no views, the simulation's name as the title) with saved false. Views deleted since are left out.
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
