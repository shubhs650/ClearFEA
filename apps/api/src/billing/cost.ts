// SPDX-License-Identifier: AGPL-3.0-or-later
// Cost of a metered job (docs/ARCHITECTURE.md section 6, ADR-033). Physics-critical in the
// sense CLAUDE.md gives it: it must be exactly right, so it is pure integer arithmetic.
// Money is whole micro-credits (1,000,000 is one credit).

import type { FailureCategory, JobType } from "@clearfea/spec";

/** Job types billed for their time on the machine. Import is free (DECISIONS.md). */
export const METERED_TYPES: readonly JobType[] = ["mesh", "solve"];

export function isMetered(type: JobType): boolean {
  return METERED_TYPES.includes(type);
}

/** Billing is per second: the measured time rounded up to whole seconds. */
export function billedSeconds(billableMs: number): number {
  if (!Number.isSafeInteger(billableMs) || billableMs < 0) {
    throw new RangeError(`billable time must be whole milliseconds, 0 or more, not ${billableMs}`);
  }
  return Math.ceil(billableMs / 1000);
}

/**
 * Seconds × hourly rate ÷ 3600, in micro-credits rounded to the nearest one (halves up).
 * Integer arithmetic only; refuses inputs whose product would not be exact in a double.
 */
export function costOf(seconds: number, ratePerHour: number): number {
  for (const [name, value] of [
    ["seconds", seconds],
    ["rate", ratePerHour],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a whole number, 0 or more, not ${value}`);
    }
  }
  const product = seconds * ratePerHour + 1800;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${seconds} s at ${ratePerHour} per hour is too large to cost exactly`);
  }
  return Math.floor(product / 3600);
}

/**
 * Who pays (docs/ARCHITECTURE.md, failure classification): the user pays for a job that
 * succeeded or failed through their own setup; a fault in ClearFEA is not charged.
 */
export function isCharged(outcome: { status: "succeeded" } | { status: "failed"; failureCategory: FailureCategory }) {
  return outcome.status === "succeeded" || outcome.failureCategory === "user_fault";
}

export interface JobCharge {
  billableMs: number;
  billedSeconds: number;
  /** Micro-credits; 0 when not charged. */
  cost: number;
  charged: boolean;
}

/** What a finished metered job costs at its own rate. */
export function chargeFor(
  billableMs: number,
  ratePerHour: number,
  outcome: Parameters<typeof isCharged>[0],
): JobCharge {
  const seconds = billedSeconds(billableMs);
  const charged = isCharged(outcome);
  return { billableMs, billedSeconds: seconds, cost: charged ? costOf(seconds, ratePerHour) : 0, charged };
}
