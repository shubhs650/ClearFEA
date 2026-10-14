# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """
    Body of GET /api/health. HTTP 200 when status is ok, 503 when degraded.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    status: Literal["ok", "degraded"]
    database: str
    """
    "ok", or what is wrong with the database and how to fix it.
    """
    storage: str
    """
    "ok", or what is wrong with file storage and how to fix it.
    """
