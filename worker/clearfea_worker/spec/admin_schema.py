# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Admin = Annotated[Any, Field(title="Admin")]
"""
Wire shapes of the admin routes (M10.3, ADR-097): the allowlist of addresses that may sign in with Google, the users, the cloud machine sizes (M10.6) and the solver machines started on AWS (M10.7). Only the admin reaches them. Each message is a definition under $defs.
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


class CloudMachineSize(BaseModel):
    """
    A machine size the live site can run on AWS (M10.6, ADR-099).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str
    cores: Annotated[int, Field(ge=1)]
    memory_bytes: Annotated[int, Field(alias="memoryBytes", ge=0)]
    enabled: bool
    """
    Switched on: runs on the live site may choose it.
    """
    default: bool
    """
    The default size, which runs every import, mesh and report job and cannot be switched off.
    """


class MachineStart(BaseModel):
    """
    One solver machine the API asked AWS to start (M10.7, ADR-100).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    size: str
    """
    A machine_sizes name: medium (standard) or large.
    """
    requested_at: Annotated[str, Field(alias="requestedAt")]
    """
    ISO 8601 UTC.
    """
    state: Literal["starting", "running", "ended", "failed"]
    """
    starting: asked for, its worker not seen yet; running: its worker made contact in the last minute; ended: its worker was seen and has stopped; failed: AWS refused it or its worker never made contact.
    """
    problem: str | None
    """
    Why AWS refused the start, in AWS's words; null otherwise.
    """


class SolverMachines(BaseModel):
    """
    The live site's solver machines and their monthly cap (M10.7, ADR-100).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    launcher: Literal["ready", "not_set_up", "local"]
    """
    ready: the API can start machines on AWS; not_set_up: it runs on cloud machines but lacks what starting one needs, which problem names; local: jobs run on the local worker and nothing is started.
    """
    problem: str | None
    hours_this_month: Annotated[float, Field(alias="hoursThisMonth", ge=0.0)]
    """
    Machine hours used this calendar month (UTC), from each start to its worker's last contact.
    """
    hours_cap: Annotated[int, Field(alias="hoursCap", ge=0)]
    """
    The monthly machine-hours cap; 0 pauses the solver.
    """
    starts: list[MachineStart]
    """
    The latest starts, newest first, at most 10.
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
    machines: Literal["cloud", "local"]
    """
    Where jobs run: cloud machines (the live site, MACHINES=cloud) or the local worker, which simulates every size and ignores the cloud size list.
    """
    cloud_sizes: Annotated[list[CloudMachineSize], Field(alias="cloudSizes")]
    solver_machines: Annotated[SolverMachines, Field(alias="solverMachines")]


class SwitchCloudSizeRequest(BaseModel):
    """
    Body of PUT /api/admin/machine-sizes/{name}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    enabled: bool


class SetMachineHoursCapRequest(BaseModel):
    """
    Body of PUT /api/admin/machine-hours-cap.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    hours: Annotated[int, Field(ge=0, le=744)]
    """
    Machine hours per calendar month (UTC); 744 is one machine for a whole month.
    """


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
