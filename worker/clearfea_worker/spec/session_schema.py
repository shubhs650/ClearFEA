# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

type Session = Annotated[Any, Field(title="Session")]
"""
Wire shapes of the session routes (docs/ARCHITECTURE.md section 8, ADR-022). Each message is a definition under $defs.
"""


class LoginRequest(BaseModel):
    """
    Body of POST /api/session.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    login: Annotated[str, Field(max_length=100, min_length=1)]
    password: Annotated[str, Field(max_length=200, min_length=1)]


class SessionUser(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    login: str
    name: str


class SessionResponse(BaseModel):
    """
    Answer to POST /api/session and GET /api/session when signed in (HTTP 200). Not signed in is HTTP 401 with an ErrorResponse.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    user: SessionUser
