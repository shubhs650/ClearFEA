// SPDX-License-Identifier: AGPL-3.0-or-later
// The stop limit of a run (M8.3, ADR-087): a run is stopped once its solve job has had the
// machine for a multiple of the estimated time. Shared by the API, which enforces it, and the
// web app, which shows the limit a multiplier gives before the run starts.

/** The multiplier a run gets when its owner does not choose one. A placeholder until beta data. */
export const DEFAULT_STOP_MULTIPLIER = 3;

/** The multipliers an owner may choose, inclusive. */
export const MIN_STOP_MULTIPLIER = 0.25;
export const MAX_STOP_MULTIPLIER = 20;

/**
 * No run is stopped sooner than this. Estimates of runs of a few seconds can be a quarter low
 * (ADR-081), and the worker hears of a stop only at its next heartbeat, every 5 s.
 */
export const MIN_STOP_SECONDS = 30;

/** The stop limit in whole seconds for a run estimated to take `estimatedSeconds`. */
export function stopLimitSeconds(estimatedSeconds: number, multiplier: number): number {
  return Math.max(MIN_STOP_SECONDS, Math.ceil(estimatedSeconds * multiplier));
}
