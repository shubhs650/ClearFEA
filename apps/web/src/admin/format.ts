// SPDX-License-Identifier: AGPL-3.0-or-later
// How the admin dashboard writes times, durations and sizes (M10.3, M13.2).

/** An API timestamp as a fixed, unambiguous UTC time, as the wallet writes it. */
export function utc(timestamp: string): string {
  return timestamp.slice(0, 16).replace("T", " ");
}

/** An API timestamp to the second, for the event log. */
export function utcSeconds(timestamp: string): string {
  return timestamp.slice(0, 19).replace("T", " ");
}

/** Machine time in hours and minutes, such as "1 h 05 min", or seconds under a minute. */
export function hours(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** A duration such as "45 s", "12 min 05 s" or "3 h 20 min". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Time since an API timestamp, as a duration. */
export function since(timestamp: string, now = Date.now()): string {
  return duration(now - Date.parse(timestamp));
}

/** Bytes in GB (10^9) above one GB, else MB, as the host's figures are read. */
export function bytes(value: number): string {
  return value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : `${Math.round(value / 1e6)} MB`;
}

/** A share from 0 to 1 as a percentage. */
export function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}
