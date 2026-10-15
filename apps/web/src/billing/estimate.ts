// SPDX-License-Identifier: AGPL-3.0-or-later
// How an estimate's memory and time are written (M2.12, ADR-049). An estimate is a fitted
// prediction, so it is rounded to two significant figures and says "about".

/** Bytes in binary units: MiB below one GiB, GiB above, two significant figures. */
export function memory(bytes: number): string {
  const GiB = 2 ** 30;
  if (bytes >= GiB) return `${Number((bytes / GiB).toPrecision(2))} GiB`;
  return `${Number(Math.max(bytes / 2 ** 20, 1).toPrecision(2))} MiB`;
}

/** Seconds as seconds, minutes or hours, whichever reads best, two significant figures. */
export function duration(seconds: number): string {
  if (seconds < 90) return `${Math.max(Math.round(seconds), 1)} s`;
  if (seconds < 90 * 60) return `${Number((seconds / 60).toPrecision(2))} min`;
  return `${Number((seconds / 3600).toPrecision(2))} h`;
}
