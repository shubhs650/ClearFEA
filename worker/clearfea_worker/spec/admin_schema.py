# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

type Admin = Annotated[Any, Field(title="Admin")]
"""
Wire shapes of the admin routes (M10.3, ADR-097): the allowlist of addresses that may sign in with Google, and the users. Only the admin reaches them. Each message is a definition under $defs.
"""


class AllowedEmail(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    email: str
    """
    Lower case.
    """
    added_at: Annotated[str, Field(alias="addedAt")]
    """
    ISO 8601 UTC.
    """


class AdminUser(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: str
    email: str | None
    """
    Null for a seeded local test user without one.
    """
    created_at: Annotated[str, Field(alias="createdAt")]
    last_sign_in: Annotated[str | None, Field(alias="lastSignIn")]
    """
    When their latest Google session started, or null.
    """
    machine_seconds_this_month: Annotated[int, Field(alias="machineSecondsThisMonth", ge=0)]
    """
    Billed machine seconds of their jobs that finished this calendar month (UTC).
    """
    allowed: bool
    """
    True when their address may sign in now: the admin's, or on the allowlist.
    """


class AdminResponse(BaseModel):
    """
    Answer to GET /api/admin and to adding or removing an address.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    admin_email: Annotated[str, Field(alias="adminEmail")]
    """
    The admin's address from the API's configuration (ADMIN_EMAIL), lower case.
    """
    allowed: list[AllowedEmail]
    users: list[AdminUser]


class AddAllowedRequest(BaseModel):
    """
    Body of POST /api/admin/allowed.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    email: Annotated[
        str,
        Field(
            max_length=254,
            min_length=3,
            pattern="^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$",
        ),
    ]
