# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

type ReportNoteCondition = Literal["tiedBonds"]
"""
When a run's report carries the note. tiedBonds: the run's frozen setup ties at least one bond (a bond the user has not removed, ADR-059, ADR-060).
"""


class ReportNote(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z][A-Za-z]*$")]
    """
    Stable name of the note.
    """
    applies_when: Annotated[ReportNoteCondition, Field(alias="appliesWhen")]
    title: Annotated[str, Field(min_length=1)]
    """
    Heading of the note in the report.
    """
    text: Annotated[str, Field(min_length=1)]
    """
    The note's paragraph, as printed.
    """
    source: Annotated[str, Field(min_length=1)]
    """
    Where the note's figures come from, for people; not printed.
    """


class ReportNotes(BaseModel):
    """
    Shape of packages/spec/report-notes.json: the standing notes a run's report prints when its setup calls for them (PLAN M4.5, M7.5; ADR-062). Each note is plain text, written once here and read by the web app and, from M7, the report job. Numbers only: no note may state a verdict (CLAUDE.md).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Annotated[int, Field(ge=1)]
    """
    Bumped whenever a note's text changes, so a report can say which wording it printed.
    """
    notes: list[ReportNote]
    """
    Every note, in the order a report prints them.
    """
