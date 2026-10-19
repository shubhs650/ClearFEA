# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Jobs = Annotated[Any, Field(title="Jobs")]
"""
Wire shapes of the job routes: the worker's internal routes and the signed-in user's public routes (docs/ARCHITECTURE.md sections 6 and 8). Each message is a definition under $defs.
"""


type JobType = Literal["noop", "import", "mesh", "solve", "report"]


type JobStatus = Literal[
    "queued", "claimed", "running", "succeeded", "failed", "cancelled", "stopped_at_limit"
]


type FailureCategory = Literal["user_fault", "platform_fault"]


type HeartbeatAction = Literal["continue", "cancel", "stop"]
"""
What the worker should do next: carry on, or end the job because the user cancelled it or it reached its stop limit.
"""


type WorkerId = Annotated[str, Field(max_length=200, min_length=1)]


class Transfer(BaseModel):
    """
    One file a job reads or writes (ADR-005). Locally the url points at the API's /internal/jobs/{id}/files route and needs the worker token; in the cloud it is a presigned storage URL.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: Annotated[str, Field(min_length=1)]
    """
    The file's name within the job, for example model.step.
    """
    direction: Literal["download", "upload"]
    url: Annotated[str, Field(min_length=1)]


class ClaimedJob(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    type: JobType
    target_id: Annotated[str | None, Field(alias="targetId")]
    params: dict[str, Any] | None
    """
    Job-type specific parameters, for example an ImportParams (geometry.schema.json); null when the type has none.
    """
    transfers: list[Transfer]


class WorkerSoftware(BaseModel):
    """
    Versions of the worker that claims a job (ADR-032), recorded on the job so a run can state what produced it. Null where the worker lacks the program.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    clearfea: Annotated[str, Field(max_length=100, min_length=1)]
    """
    The worker package's version, with the source commit it was built from after a + when known, for example 0.0.0+d9d394b.
    """
    deck_format: Annotated[int, Field(alias="deckFormat", ge=1)]
    """
    The deck generator's DECK_FORMAT.
    """
    calculix: Annotated[str | None, Field(max_length=100)]
    gmsh: Annotated[str | None, Field(max_length=100)]


class ClaimRequest(BaseModel):
    """
    Body of POST /internal/jobs/claim.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    job_types: Annotated[list[JobType], Field(alias="jobTypes")]
    software: WorkerSoftware | None = None
    machine_size: Annotated[
        str | None, Field(alias="machineSize", pattern="^[a-z0-9][a-z0-9-]{0,31}$")
    ] = None
    """
    The machine size the worker runs on (M10.6, ADR-098), from CLEARFEA_MACHINE_SIZE: it is given only that size's jobs, and the default size's also takes the jobs that have no size (import, report). Left out by a local worker, which takes every size's jobs.
    """


class ClaimResponse(BaseModel):
    """
    Answer to a claim when a job was claimed (HTTP 200). No job to claim is HTTP 204 with no body.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job: ClaimedJob


class HeartbeatRequest(BaseModel):
    """
    Body of POST /internal/jobs/{id}/heartbeat.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    stage: str | None = None
    log: Annotated[str | None, Field(max_length=65536)] = None
    """
    Log text the job wrote since the previous heartbeat, appended to the job's log as one chunk (ADR-030).
    """


class HeartbeatResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    action: HeartbeatAction


class Metering(BaseModel):
    """
    What the worker measured of a job (ADR-033): billableMs is the wall-clock time from the start to the end of the job's handler on the machine, in whole milliseconds. Queue time and the worker's start-up are outside it. Sent for every job; the API charges only metered job types.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    billable_ms: Annotated[int, Field(alias="billableMs", ge=0, le=2592000000)]


class CompleteSucceeded(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    status: Literal["succeeded"]
    metering: Metering
    result: dict[str, Any] | None = None
    """
    Job-type specific summary, stored as given.
    """


class CompleteFailed(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    status: Literal["failed"]
    metering: Metering
    failure_category: Annotated[FailureCategory, Field(alias="failureCategory")]
    failure_cause: Annotated[str, Field(alias="failureCause", min_length=1)]
    failure_message: Annotated[str | None, Field(alias="failureMessage", min_length=1)] = None
    """
    What went wrong and what to do about it, in plain language for the job's owner.
    """


class CompleteStopped(BaseModel):
    """
    The worker ended the job because a heartbeat told it to (cancel or stop, M8.2): it reports the time it used. The API records the job as cancelled or stopped at its limit, as it asked, and charges the time (DECISIONS "Failed runs").
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    status: Literal["stopped"]
    metering: Metering


type CompleteRequest = CompleteSucceeded | CompleteFailed | CompleteStopped
"""
Body of POST /internal/jobs/{id}/complete.
"""


class CompletedJob(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    type: JobType
    target_id: Annotated[str | None, Field(alias="targetId")]
    status: JobStatus


class CompleteResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job: CompletedJob


class CreateJobRequest(BaseModel):
    """
    Body of POST /api/jobs. Only a noop job is queued directly; later job types are created by the routes for the records they work on.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["noop"]


class JobView(BaseModel):
    """
    A job as its owner sees it. Timestamps are ISO 8601 UTC strings.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    type: JobType
    target_id: Annotated[str | None, Field(alias="targetId")]
    status: JobStatus
    stage: str | None
    failure_category: Annotated[FailureCategory | None, Field(alias="failureCategory")]
    failure_cause: Annotated[str | None, Field(alias="failureCause")]
    failure_message: Annotated[str | None, Field(alias="failureMessage")]
    created_at: Annotated[str, Field(alias="createdAt")]
    claimed_at: Annotated[str | None, Field(alias="claimedAt")]
    finished_at: Annotated[str | None, Field(alias="finishedAt")]


class JobResponse(BaseModel):
    """
    Answer to POST /api/jobs (HTTP 201) and GET /api/jobs/{id}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job: JobView


class JobListResponse(BaseModel):
    """
    Answer to GET /api/jobs: the signed-in user's most recent jobs, newest first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    jobs: list[JobView]


class ErrorResponse(BaseModel):
    """
    Body of any 4xx or 5xx answer: what is wrong and what to do about it.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    error: str
