# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type Admin = Annotated[Any, Field(title="Admin")]
"""
Wire shapes of the admin routes (M10.3, ADR-097): the allowlist of addresses that may sign in with Google, the users, the cloud machine sizes (M10.6) the solver machines started on AWS (M10.7), the statistics (M12.3) the event log (M13.1) the dashboard's overview and jobs (M13.2), and its settings and costs (M13.3). Only the admin reaches them. Each message is a definition under $defs.
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
    jobs_this_month: Annotated[int, Field(alias="jobsThisMonth", ge=0)]
    """
    Their jobs that finished this calendar month (UTC), whatever the outcome.
    """
    failed_jobs_this_month: Annotated[int, Field(alias="failedJobsThisMonth", ge=0)]
    """
    Of those, the ones that failed, whoever's fault.
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


class SolverHost(BaseModel):
    """
    The always-on solver host (M12.4, ADR-120), from its compute manager's check-ins.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    host: str
    online: bool
    """
    True when it checked in within the last 120 s; while no host is online, new jobs are refused.
    """
    last_seen_at: Annotated[str, Field(alias="lastSeenAt")]
    """
    ISO 8601 UTC.
    """
    first_seen_at: Annotated[str, Field(alias="firstSeenAt")]
    """
    ISO 8601 UTC: when this run of check-ins began, after a silence of more than 120 s or the first ever.
    """
    manager_version: Annotated[str | None, Field(alias="managerVersion")]


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
    machines: Literal["cloud", "vps", "local"]
    """
    Where jobs run: cloud machines started on AWS (MACHINES=cloud), the always-on solver host (MACHINES=vps, M12.4, ADR-120) or the local worker, which simulates every size and ignores the cloud size list.
    """
    cloud_sizes: Annotated[list[CloudMachineSize], Field(alias="cloudSizes")]
    solver_machines: Annotated[SolverMachines, Field(alias="solverMachines")]
    solver_host: Annotated[SolverHost | None, Field(alias="solverHost")]
    """
    The solver host that checked in last; null when none ever has.
    """


class JobTry(BaseModel):
    """
    One try of a job (M12.3, ADR-109, ADR-123), for support: queue wait, stage times, model size, solver and what its container used. Admin only.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job_id: Annotated[str, Field(alias="jobId")]
    job_type: Annotated[
        Literal["noop", "import", "mesh", "solve", "report"], Field(alias="jobType")
    ]
    owner_id: Annotated[str, Field(alias="ownerId")]
    """
    The user the job is for; nothing else of their records is shown.
    """
    target_id: Annotated[str | None, Field(alias="targetId")]
    """
    The geometry, mesh or run the job works on: a run id for a solve job.
    """
    attempt: Annotated[int, Field(ge=1)]
    """
    1 for the first try; a job re-queued after a platform fault (M12.2) is tried again under the same id.
    """
    worker_id: Annotated[str, Field(alias="workerId")]
    host: str | None
    """
    The solver host, from the compute manager's statistics; null from any other worker.
    """
    lane: str | None
    image: str | None
    """
    The worker image id the container ran.
    """
    queued_at: Annotated[str, Field(alias="queuedAt")]
    """
    ISO 8601 UTC: when this try began to wait: the job's creation, or the end of its previous try.
    """
    claimed_at: Annotated[str, Field(alias="claimedAt")]
    ended_at: Annotated[str | None, Field(alias="endedAt")]
    """
    Null while the try runs.
    """
    queue_wait_ms: Annotated[int, Field(alias="queueWaitMs", ge=0)]
    stage_ms: Annotated[dict[str, int], Field(alias="stageMs")]
    """
    Milliseconds in each stage the worker reported, as seen by its heartbeats every 5 s; "starting" is from the claim to the first heartbeat.
    """
    last_stage: Annotated[str | None, Field(alias="lastStage")]
    """
    The stage the try was in when it ended, or is in now.
    """
    status: Literal["succeeded", "failed", "cancelled", "stopped_at_limit"] | None
    """
    How the try ended; null while it runs.
    """
    failure_category: Annotated[
        Literal["user_fault", "platform_fault"] | None, Field(alias="failureCategory")
    ]
    failure_cause: Annotated[str | None, Field(alias="failureCause")]
    nodes: int | None
    """
    Of the mesh made (mesh job) or solved on (solve job).
    """
    elements: int | None
    dofs: int | None
    """
    Unknowns of the solve: three per node for a structural run, one for a thermal one.
    """
    solver: str | None
    analysis: str | None
    exit_code: Annotated[int | None, Field(alias="exitCode")]
    signal: int | None
    """
    exitCode - 128 when the container was ended by a signal (9: killed).
    """
    out_of_memory: Annotated[bool | None, Field(alias="outOfMemory")]
    run_ms: Annotated[int | None, Field(alias="runMs")]
    """
    The container's run time.
    """
    peak_memory_bytes: Annotated[int | None, Field(alias="peakMemoryBytes")]
    cpu_seconds: Annotated[float | None, Field(alias="cpuSeconds")]
    cpu_average: Annotated[float | None, Field(alias="cpuAverage")]
    """
    cpuSeconds over runMs, in CPUs.
    """
    cpu_peak: Annotated[float | None, Field(alias="cpuPeak")]
    disk_written_bytes: Annotated[int | None, Field(alias="diskWrittenBytes")]


class JobTriesResponse(BaseModel):
    """
    Answer of GET /api/admin/stats/jobs: tries newest first, of one job (?job=), of the jobs of one record such as a run (?target=), or of all jobs (?before= pages on).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tries: list[JobTry]


class HostLoadSample(BaseModel):
    """
    The solver host's load at one check-in (M12.3, ADR-109): shares from 0 to 1, bytes.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    host: str
    at: str
    """
    ISO 8601 UTC.
    """
    cpu: float | None
    steal: float | None
    load1: float
    load5: float
    load15: float
    memory_total_bytes: Annotated[int, Field(alias="memoryTotalBytes")]
    memory_available_bytes: Annotated[int, Field(alias="memoryAvailableBytes")]
    disk_total_bytes: Annotated[int, Field(alias="diskTotalBytes")]
    disk_free_bytes: Annotated[int, Field(alias="diskFreeBytes")]
    containers: int


class HostLoadResponse(BaseModel):
    """
    Answer of GET /api/admin/stats/host: the host's load samples since ?since= (default the last hour), oldest first, kept 14 days.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    samples: list[HostLoadSample]


class AdminEvent(BaseModel):
    """
    One entry of the event log (M13.1, ADR-113, ADR-125): what happened, to whom and how serious it is. For support: ids and plain words, never a project's name, model or results.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[int, Field(ge=1)]
    at: str
    """
    ISO 8601 UTC.
    """
    kind: Literal[
        "sign_in",
        "sign_in_refused",
        "job_failed",
        "job_retried",
        "host_online",
        "host_offline",
        "manager_started",
        "admin_action",
    ]
    """
    sign_in and sign_in_refused: a sign-in, or one refused (Google, a local password or the verification token); job_failed: a job ended failed, through the user's setup (info) or a fault in ClearFEA (error); job_retried: a machine fault ended a try and the job was queued again; host_online and host_offline: the solver host checked in after a silence (or for the first time), or has been silent for 120 s; manager_started: its compute manager restarted while the host stayed online; admin_action: the admin changed something.
    """
    level: Literal["info", "warning", "error"]
    user_id: Annotated[str | None, Field(alias="userId")]
    """
    The user it is about: who signed in, whose job it was, the admin who acted.
    """
    job_id: Annotated[str | None, Field(alias="jobId")]
    host: str | None
    message: str
    """
    One line in plain words.
    """
    detail: dict[str, Any] | None
    """
    The particulars as named values, such as the failure cause, the try, or the address refused.
    """


class EventsResponse(BaseModel):
    """
    Answer of GET /api/admin/events: events newest first, filtered by ?kind=, ?level=, ?user=, ?since= and ?before= (times), at most ?limit= (up to 500).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    events: list[AdminEvent]


class AdminJob(BaseModel):
    """
    A job of any user as the dashboard's Overview and Jobs and runs tabs show it (M13.2, ADR-113, ADR-127): its state, tries and failure, for support. Ids and an address, never a project's name, model or results.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    type: Literal["noop", "import", "mesh", "solve", "report"]
    lane: Literal["solve", "light"]
    """
    Solve jobs run in the solve lane, the rest in the light lane (ADR-107).
    """
    status: Literal[
        "queued", "claimed", "running", "succeeded", "failed", "cancelled", "stopped_at_limit"
    ]
    stage: str | None
    """
    The stage its worker reported last.
    """
    owner_id: Annotated[str, Field(alias="ownerId")]
    owner_email: Annotated[str | None, Field(alias="ownerEmail")]
    """
    The owner's address; null for a local test user without one.
    """
    target_id: Annotated[str | None, Field(alias="targetId")]
    """
    The geometry, mesh or run the job works on: a run id for a solve job.
    """
    attempt: Annotated[int, Field(ge=1)]
    machine_size: Annotated[str | None, Field(alias="machineSize")]
    claimed_by: Annotated[str | None, Field(alias="claimedBy")]
    """
    The worker id holding it, or that last held it.
    """
    stop_requested: Annotated[
        Literal["cancelled", "stopped_at_limit"] | None, Field(alias="stopRequested")
    ]
    """
    How its owner or its stop limit asked it to end, while it still runs.
    """
    created_at: Annotated[str, Field(alias="createdAt")]
    """
    ISO 8601 UTC.
    """
    claimed_at: Annotated[str | None, Field(alias="claimedAt")]
    heartbeat_at: Annotated[str | None, Field(alias="heartbeatAt")]
    finished_at: Annotated[str | None, Field(alias="finishedAt")]
    failure_category: Annotated[
        Literal["user_fault", "platform_fault"] | None, Field(alias="failureCategory")
    ]
    failure_cause: Annotated[str | None, Field(alias="failureCause")]
    failure_message: Annotated[str | None, Field(alias="failureMessage")]
    """
    What its owner was told, for support.
    """
    peak_memory_bytes: Annotated[int | None, Field(alias="peakMemoryBytes")]
    billed_seconds: Annotated[int | None, Field(alias="billedSeconds")]
    queue_position: Annotated[int | None, Field(alias="queuePosition", ge=1)]
    """
    Its place among the queued jobs of its lane, oldest first; null unless queued.
    """


class AdminJobsResponse(BaseModel):
    """
    Answer of GET /api/admin/jobs: jobs newest first, filtered by ?status=, ?type=, ?user= and ?before= (a creation time, to page on), at most ?limit= (up to 500).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    jobs: list[AdminJob]


class AdminJobResponse(BaseModel):
    """
    Answer of POST /api/admin/jobs/{id}/cancel and /requeue: the job as it is now.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    job: AdminJob


class AdminJobLogResponse(BaseModel):
    """
    Answer of GET /api/admin/jobs/{id}/log?after={n}: the job's log written after chunk n, the n to ask with next time, and whether more chunks are already written.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    text: str
    next: Annotated[int, Field(ge=0)]
    more: bool


class AdminLane(BaseModel):
    """
    One lane of the solver host (ADR-107): the jobs running in it and the jobs waiting for it, oldest first.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    lane: Literal["solve", "light"]
    running: list[AdminJob]
    """
    Claimed or running.
    """
    queued: list[AdminJob]


class AdminAlert(BaseModel):
    """
    Something the admin should act on, shown on the dashboard only (Shubham, 2026-10-22).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal[
        "no_host", "host_offline", "queue_paused", "disk_low", "out_of_memory", "platform_failures"
    ]
    level: Literal["warning", "error"]
    message: str
    """
    What is wrong and what to do, in plain words.
    """


class OverviewResponse(BaseModel):
    """
    Answer of GET /api/admin/overview and PUT /api/admin/queue-paused: the solver host and its latest load, the lanes and their queues, whether the queue is paused, and the alerts.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    machines: Literal["cloud", "vps", "local"]
    paused: bool
    """
    True while the admin has paused the queue: no job starts, running jobs finish, new jobs still queue.
    """
    paused_at: Annotated[str | None, Field(alias="pausedAt")]
    """
    When the admin paused it, ISO 8601 UTC; null while it runs.
    """
    host: SolverHost | None
    """
    The solver host that checked in last; null when none ever has.
    """
    load: HostLoadSample | None
    """
    That host's latest load sample in the last 10 minutes, or null.
    """
    lanes: list[AdminLane]
    """
    The solve lane, then the light lane.
    """
    alerts: list[AdminAlert]


class SetQueuePausedRequest(BaseModel):
    """
    Body of PUT /api/admin/queue-paused.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    paused: bool


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


class AdminSetting(BaseModel):
    """
    One setting the admin may change on the Settings tab (M13.3, ADR-128). The stored value is a whole number; the dashboard shows it divided by scale, in unit.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: str
    """
    The row of the settings table.
    """
    group: Literal["accounts", "queue", "storage", "machines", "costs", "alerts"]
    label: str
    description: str
    """
    What it does, in plain words.
    """
    unit: str
    """
    The unit it is shown in, such as GiB, days or USD.
    """
    scale: Annotated[int, Field(ge=1)]
    """
    Stored units per shown unit, such as 1073741824 bytes per GiB.
    """
    min: int
    """
    The smallest stored value allowed.
    """
    max: int
    """
    The largest stored value allowed.
    """
    value: int
    """
    The stored value now.
    """


class SettingsResponse(BaseModel):
    """
    Answer of GET /api/admin/settings and PUT /api/admin/settings/{name}.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    settings: list[AdminSetting]


class SetSettingRequest(BaseModel):
    """
    Body of PUT /api/admin/settings/{name}: the new stored value, which must be a whole number from the setting's min to its max.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    value: int


class CostsUser(BaseModel):
    """
    One user's usage in the month.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    user_id: Annotated[str, Field(alias="userId")]
    name: str
    email: str | None
    jobs: Annotated[int, Field(ge=0)]
    """
    Jobs that finished in the month.
    """
    solve_runs: Annotated[int, Field(alias="solveRuns", ge=0)]
    """
    Solve jobs that finished in the month.
    """
    machine_seconds: Annotated[int, Field(alias="machineSeconds", ge=0)]
    """
    Their billed machine seconds.
    """
    job_micro_credits: Annotated[int, Field(alias="jobMicroCredits", ge=0)]
    """
    Micro-credits charged for jobs in the month.
    """
    storage_micro_credits: Annotated[int, Field(alias="storageMicroCredits", ge=0)]
    """
    Micro-credits charged for storage in the month.
    """


class CostsJobType(BaseModel):
    """
    One job type's usage in the month.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Literal["noop", "import", "mesh", "solve", "report"]
    jobs: Annotated[int, Field(ge=0)]
    """
    Jobs that finished in the month.
    """
    machine_seconds: Annotated[int, Field(alias="machineSeconds", ge=0)]
    """
    Their billed machine seconds.
    """
    job_micro_credits: Annotated[int, Field(alias="jobMicroCredits", ge=0)]
    """
    Micro-credits charged for jobs in the month.
    """


class CostsTotals(BaseModel):
    """
    The month's usage over all users.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    jobs: Annotated[int, Field(ge=0)]
    """
    Jobs that finished in the month.
    """
    solve_runs: Annotated[int, Field(alias="solveRuns", ge=0)]
    """
    Solve jobs that finished in the month.
    """
    machine_seconds: Annotated[int, Field(alias="machineSeconds", ge=0)]
    """
    Their billed machine seconds.
    """
    job_micro_credits: Annotated[int, Field(alias="jobMicroCredits", ge=0)]
    """
    Micro-credits charged for jobs in the month.
    """
    storage_micro_credits: Annotated[int, Field(alias="storageMicroCredits", ge=0)]
    """
    Micro-credits charged for storage in the month.
    """


class CostsResponse(BaseModel):
    """
    Answer of GET /api/admin/costs?month=YYYY-MM (M13.3, ADR-128): one calendar month's (UTC) usage by user and by job type, and the beta's monthly costs from the settings.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    month: Annotated[str, Field(pattern="^[0-9]{4}-(0[1-9]|1[0-2])$")]
    solver_host_cents: Annotated[int, Field(alias="solverHostCents", ge=0)]
    """
    What the solver host costs a month, in US cents (setting solver_host_monthly_cents).
    """
    platform_cents: Annotated[int, Field(alias="platformCents", ge=0)]
    """
    What Cloudflare costs a month, in US cents (setting platform_monthly_cents).
    """
    totals: CostsTotals
    by_user: Annotated[list[CostsUser], Field(alias="byUser")]
    """
    Users with any job or charge in the month, the most machine time first.
    """
    by_type: Annotated[list[CostsJobType], Field(alias="byType")]
    """
    Job types with any job in the month, the most machine time first.
    """
