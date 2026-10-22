// SPDX-License-Identifier: AGPL-3.0-or-later
// The dashboard's tables as the admin exports them (M13.4, ADR-113, ADR-129): what each holds,
// its columns, and which time picks its rows for a date range. Read through the data-access layer
// as the tabs read them, by the admin only; ids, addresses, statistics and failure messages, never
// a project's name, model or results. Values stay in their stored units (seconds, bytes,
// micro-credits), named in each heading.

import { MICRO_CREDITS } from "@clearfea/spec";
import { listAllowed, listUsers } from "../db/allowlist";
import { listAdminJobs } from "../db/adminJobs";
import { usageBetween } from "../db/costs";
import { listEvents } from "../db/events";
import { listSettings } from "../db/settings";
import { listHostLoad, listTries } from "../db/stats";
import type { Cell, Column, Table } from "./sheet";

/** A date range as times: from its first day's start to the start of the day after its last. */
export interface Range {
  from: string;
  to: string;
}

/** Most rows one table exports; a longer one asks for a shorter range rather than being cut. */
export const MAX_EXPORT_ROWS = 50_000;

export const EXPORT_TABLES = [
  "jobs",
  "tries",
  "events",
  "host-load",
  "users",
  "invited",
  "settings",
  "costs-by-user",
  "costs-by-type",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

const text = (header: string): Column => ({ header, kind: "text" });
const number = (header: string): Column => ({ header, kind: "number" });
const time = (header: string): Column => ({ header, kind: "time" });
const yesNo = (header: string): Column => ({ header, kind: "boolean" });

/** Micro-credits as credits, the unit the wallet and Costs tab show. */
const credits = (micro: number): number => micro / MICRO_CREDITS;

interface Definition {
  sheet: string;
  columns: Column[];
  /** The table's rows, at most `limit`; `range` is ignored by tables that are as of now. */
  rows: (db: D1Database, range: Range, limit: number) => Promise<Cell[][]>;
}

const DEFINITIONS: Record<ExportTable, Definition> = {
  jobs: {
    sheet: "Jobs",
    columns: [
      text("Job"),
      text("Type"),
      text("Lane"),
      text("Status"),
      text("Stage"),
      text("User"),
      text("User's address"),
      text("Works on"),
      number("Try"),
      text("Machine size"),
      text("Worker"),
      time("Created (UTC)"),
      time("Claimed (UTC)"),
      time("Last heartbeat (UTC)"),
      time("Finished (UTC)"),
      text("Failure category"),
      text("Failure cause"),
      text("Failure message"),
      number("Peak memory (bytes)"),
      number("Billed machine time (s)"),
    ],
    // Jobs created in the range, oldest first.
    rows: async (db, range, limit) =>
      (await listAdminJobs(db, { since: range.from, before: range.to, oldestFirst: true, limit })).map((job) => [
        job.id,
        job.type,
        job.lane,
        job.status,
        job.stage,
        job.ownerId,
        job.ownerEmail,
        job.targetId,
        job.attempt,
        job.machineSize,
        job.claimedBy,
        job.createdAt,
        job.claimedAt,
        job.heartbeatAt,
        job.finishedAt,
        job.failureCategory,
        job.failureCause,
        job.failureMessage,
        job.peakMemoryBytes,
        job.billedSeconds,
      ]),
  },
  tries: {
    sheet: "Tries",
    columns: [
      text("Job"),
      text("Type"),
      text("User"),
      text("Works on"),
      number("Try"),
      text("Worker"),
      text("Host"),
      text("Lane"),
      text("Image"),
      time("Waiting from (UTC)"),
      time("Claimed (UTC)"),
      time("Ended (UTC)"),
      number("Queue wait (ms)"),
      text("Time in each stage (ms)"),
      text("Last stage"),
      text("Status"),
      text("Failure category"),
      text("Failure cause"),
      number("Nodes"),
      number("Elements"),
      number("Unknowns"),
      text("Solver"),
      text("Analysis"),
      number("Exit code"),
      number("Signal"),
      yesNo("Out of memory"),
      number("Run time (ms)"),
      number("Peak memory (bytes)"),
      number("CPU time (s)"),
      number("Average CPUs"),
      number("Peak CPUs"),
      number("Disk written (bytes)"),
    ],
    // Tries claimed in the range, oldest first.
    rows: async (db, range, limit) =>
      (await listTries(db, { since: range.from, before: range.to, oldestFirst: true, limit })).map((t) => [
        t.jobId,
        t.jobType,
        t.ownerId,
        t.targetId,
        t.attempt,
        t.workerId,
        t.host,
        t.lane,
        t.image,
        t.queuedAt,
        t.claimedAt,
        t.endedAt,
        t.queueWaitMs,
        Object.entries(t.stageMs)
          .map(([stage, ms]) => `${stage} ${ms}`)
          .join("; "),
        t.lastStage,
        t.status,
        t.failureCategory,
        t.failureCause,
        t.nodes,
        t.elements,
        t.dofs,
        t.solver,
        t.analysis,
        t.exitCode,
        t.signal,
        t.outOfMemory,
        t.runMs,
        t.peakMemoryBytes,
        t.cpuSeconds,
        t.cpuAverage,
        t.cpuPeak,
        t.diskWrittenBytes,
      ]),
  },
  events: {
    sheet: "Events",
    columns: [
      number("Event"),
      time("Time (UTC)"),
      text("Kind"),
      text("Level"),
      text("User"),
      text("Job"),
      text("Host"),
      text("What happened"),
      text("Details (JSON)"),
    ],
    // Events in the range, oldest first.
    rows: async (db, range, limit) =>
      (await listEvents(db, { since: range.from, before: range.to, oldestFirst: true, limit })).map((event) => [
        event.id,
        event.at,
        event.kind,
        event.level,
        event.userId,
        event.jobId,
        event.host,
        event.message,
        event.detail === null ? null : JSON.stringify(event.detail),
      ]),
  },
  "host-load": {
    sheet: "Host load",
    columns: [
      text("Host"),
      time("Time (UTC)"),
      number("CPU (share 0 to 1)"),
      number("Steal (share 0 to 1)"),
      number("Load, 1 min"),
      number("Load, 5 min"),
      number("Load, 15 min"),
      number("Memory (bytes)"),
      number("Memory available (bytes)"),
      number("Disk (bytes)"),
      number("Disk free (bytes)"),
      number("Containers"),
    ],
    // The solver host's samples in the range, oldest first.
    rows: async (db, range, limit) =>
      (await listHostLoad(db, range.from, range.to, limit)).map((s) => [
        s.host,
        s.at,
        s.cpu,
        s.steal,
        s.load1,
        s.load5,
        s.load15,
        s.memoryTotalBytes,
        s.memoryAvailableBytes,
        s.diskTotalBytes,
        s.diskFreeBytes,
        s.containers,
      ]),
  },
  users: {
    sheet: "Users",
    columns: [
      text("User"),
      text("Name"),
      text("Address"),
      time("Joined (UTC)"),
      time("Last Google sign-in (UTC)"),
      number("Jobs finished in range"),
      number("Failed jobs in range"),
      number("Billed machine time in range (s)"),
    ],
    // Every user (as now), with the jobs that finished in the range.
    rows: async (db, range, limit) =>
      (await listUsers(db, range))
        .slice(0, limit)
        .map((user) => [
          user.id,
          user.name,
          user.email,
          user.createdAt,
          user.lastSignIn,
          user.jobsThisMonth,
          user.failedJobsThisMonth,
          user.machineSecondsThisMonth,
        ]),
  },
  invited: {
    sheet: "Invited",
    columns: [text("Address"), time("Invited (UTC)")],
    // The allowlist as it is now.
    rows: async (db, _range, limit) =>
      (await listAllowed(db)).slice(0, limit).map((entry) => [entry.email, entry.addedAt]),
  },
  settings: {
    sheet: "Settings",
    columns: [
      text("Setting"),
      text("Group"),
      text("Label"),
      number("Value"),
      text("Unit"),
      number("Stored value"),
      number("Stored per unit"),
      number("Smallest stored value"),
      number("Largest stored value"),
    ],
    // Every setting as it is now, as the Settings tab shows it and as stored.
    rows: async (db, _range, limit) =>
      (await listSettings(db))
        .slice(0, limit)
        .map((s) => [s.name, s.group, s.label, s.value / s.scale, s.unit, s.value, s.scale, s.min, s.max]),
  },
  "costs-by-user": {
    sheet: "Costs by user",
    columns: [
      text("User"),
      text("Name"),
      text("Address"),
      number("Jobs finished"),
      number("Runs solved"),
      number("Billed machine time (s)"),
      number("Charged for jobs (credits)"),
      number("Charged for storage (credits)"),
    ],
    // As the Costs tab counts a month: jobs that finished and charges written in the range.
    rows: async (db, range, limit) =>
      (await usageBetween(db, range)).byUser
        .slice(0, limit)
        .map((u) => [
          u.userId,
          u.name,
          u.email,
          u.jobs,
          u.solveRuns,
          u.machineSeconds,
          credits(u.jobMicroCredits),
          credits(u.storageMicroCredits),
        ]),
  },
  "costs-by-type": {
    sheet: "Costs by job type",
    columns: [text("Job type"), number("Jobs finished"), number("Billed machine time (s)"), number("Charged (credits)")],
    rows: async (db, range, limit) =>
      (await usageBetween(db, range)).byType
        .slice(0, limit)
        .map((t) => [t.type, t.jobs, t.machineSeconds, credits(t.jobMicroCredits)]),
  },
};

/** True for the tables that are as of now rather than of a date range. */
export function isSnapshot(name: ExportTable): boolean {
  return name === "invited" || name === "settings";
}

/** One table of the range, or "too_many" when it has more than `MAX_EXPORT_ROWS` rows. */
export async function exportTable(db: D1Database, name: ExportTable, range: Range): Promise<Table | "too_many"> {
  const definition = DEFINITIONS[name];
  const rows = await definition.rows(db, range, MAX_EXPORT_ROWS + 1);
  if (rows.length > MAX_EXPORT_ROWS) return "too_many";
  return { sheet: definition.sheet, columns: definition.columns, rows };
}
