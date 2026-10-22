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
    The machine size the worker runs on (M10.6, ADR-099), from CLEARFEA_MACHINE_SIZE: it is given only that size's jobs, and the default size's also takes the jobs that have no size (import, report). Left out by a local worker, which takes every size's jobs.
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


class HostLoad(BaseModel):
    """
    The solver host's load when it checked in (M12.3, ADR-109, ADR-123), kept as host_stats for 14 days. CPU and steal are shares of all the host's CPU time since the previous check-in, from 0 to 1, absent at the manager's first check-in; memory and disk in bytes.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    cpu: Annotated[float | None, Field(ge=0.0, le=1.0)] = None
    steal: Annotated[float | None, Field(ge=0.0, le=1.0)] = None
    """
    CPU time the hypervisor gave to other machines while this one wanted it.
    """
    load1: Annotated[float, Field(ge=0.0)]
    load5: Annotated[float, Field(ge=0.0)]
    load15: Annotated[float, Field(ge=0.0)]
    memory_total_bytes: Annotated[int, Field(alias="memoryTotalBytes", ge=0)]
    memory_available_bytes: Annotated[int, Field(alias="memoryAvailableBytes", ge=0)]
    disk_total_bytes: Annotated[int, Field(alias="diskTotalBytes", ge=0)]
    """
    Of the file system holding Docker's data, where the jobs' scratch volumes are.
    """
    disk_free_bytes: Annotated[int, Field(alias="diskFreeBytes", ge=0)]
    containers: Annotated[int, Field(ge=0)]
    """
    Containers running on the host, job containers and others.
    """


class ContainerStats(BaseModel):
    """
    Body of POST /internal/jobs/{id}/stats (M12.3, ADR-109, ADR-123): what the compute manager measured of one try of a job from its container, sent once the container has ended. Memory, CPU and disk come from Docker's container statistics sampled every 5 s, so a peak shorter than that can be missed. The API answers 204, or 404 when the worker has no try of that job still without these statistics.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    worker_id: Annotated[WorkerId, Field(alias="workerId")]
    host: Annotated[str, Field(pattern="^[A-Za-z0-9._-]{1,64}$")]
    lane: Annotated[str, Field(max_length=32, min_length=1)]
    image: Annotated[str, Field(max_length=100, min_length=1)]
    """
    The id of the worker image the container ran (sha256:...).
    """
    exit_code: Annotated[int | None, Field(alias="exitCode")]
    """
    The container's exit code; above 128 it was ended by signal exitCode - 128. Null when it never started.
    """
    out_of_memory: Annotated[bool, Field(alias="outOfMemory")]
    """
    Docker stopped the container at its memory limit.
    """
    run_ms: Annotated[int, Field(alias="runMs", ge=0)]
    """
    From the container's start to its end.
    """
    samples: Annotated[int, Field(ge=0)]
    """
    Statistics samples taken; with none, memory, CPU and disk are left out.
    """
    peak_memory_bytes: Annotated[int | None, Field(alias="peakMemoryBytes", ge=0)] = None
    cpu_seconds: Annotated[float | None, Field(alias="cpuSeconds", ge=0.0)] = None
    """
    CPU time the container used over all its CPUs, at the last sample.
    """
    cpu_peak: Annotated[float | None, Field(alias="cpuPeak", ge=0.0)] = None
    """
    The most CPUs busy between two samples (6 is six CPUs busy).
    """
    disk_written_bytes: Annotated[int | None, Field(alias="diskWrittenBytes", ge=0)] = None
    """
    Bytes the container wrote to block devices, its scratch volume among them, at the last sample.
    """


class HostCheckInResponse(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    interval_seconds: Annotated[int, Field(alias="intervalSeconds", ge=1)]
    """
    Seconds until the next check-in is due.
    """


class Metering(BaseModel):
    """
    What the worker measured of a job (ADR-033): billableMs is the wall-clock time from the start to the end of the job's handler on the machine, in whole milliseconds. Queue time and the worker's start-up are outside it. Sent for every job; the API charges only metered job types.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    billable_ms: Annotated[int, Field(alias="billableMs", ge=0, le=2592000000)]
    peak_memory_bytes: Annotated[int | None, Field(alias="peakMemoryBytes", ge=0)] = None
    """
    The largest resident memory of the job's solver the worker measured, or the job container's memory limit when the kernel stopped it there (M12.2, ADR-108). Absent where it was not measured.
    """


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


class JobListResponse(BaseModel):
    """
    Answer to GET /api/jobs: the signed-in user's most recent jobs, newest first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    jobs: list[JobView]


class JobWait(BaseModel):
    """
    How a job that has not finished is getting on (M11.2, ADR-112). Sent as `wait` with the answers the screens poll while a job works on what they show: GET /api/jobs/{id}, /api/geometries/{id}, /api/simulations/{id}/mesh, /api/runs/{id} and /api/runs/{id}/report. Left out once the job has finished.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    status: JobStatus
    queue_position: Annotated[int | None, Field(alias="queuePosition", ge=1)]
    """
    While the job is queued, its place among the queued jobs of its machine size, counting every user's jobs: 1 is next. Null once a worker has claimed it.
    """
    machine_starting: Annotated[bool, Field(alias="machineStarting")]
    """
    True on the live site while the job is queued and no machine of its size is running, or one is being started (ADR-103). Always false locally, where the worker is always there.
    """
    retry_after: Annotated[int, Field(alias="retryAfter", ge=1, le=30)]
    """
    Seconds after which asking again is worth it. The browser waits at least this long, and never more than 30 s.
    """


class ErrorResponse(BaseModel):
    """
    Body of any 4xx or 5xx answer: what is wrong and what to do about it.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    error: str


class HostCheckIn(BaseModel):
    """
    Body of POST /internal/hosts/check-in (M12.4, ADR-120): the solver host's compute manager says it is up, at start and every intervalSeconds whatever its lanes are doing. With MACHINES=vps the API refuses new jobs while no host has checked in for 120 s.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    host: Annotated[str, Field(pattern="^[A-Za-z0-9._-]{1,64}$")]
    """
    The host's name, as the admin page shows it.
    """
    manager_version: Annotated[
        str | None, Field(alias="managerVersion", max_length=100, min_length=1)
    ] = None
    started_at: Annotated[str | None, Field(alias="startedAt", max_length=40, min_length=1)] = None
    """
    ISO 8601 UTC: when the compute manager started (M13.1, ADR-125). A new value while the host stays online is recorded as a restart of the manager.
    """
    load: HostLoad | None = None


class JobResponse(BaseModel):
    """
    Answer to POST /api/jobs (HTTP 201) and GET /api/jobs/{id}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job: JobView
    wait: JobWait | None = None
