// SPDX-License-Identifier: AGPL-3.0-or-later
// Stored sizes on the wallet page (M8.6, ADR-086): binary units, as the storage allowance and
// rate are per GiB.

const UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;

/** A size in bytes, in whole bytes below a KiB and to three significant figures above. */
export function bytes(size: number): string {
  if (size < 1024) return `${size.toLocaleString("en-US")} ${size === 1 ? "byte" : "bytes"}`;
  let value = size;
  let unit = 0;
  value /= 1024;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number(value.toPrecision(3)).toLocaleString("en-US")} ${UNITS[unit]}`;
}
