// SPDX-License-Identifier: AGPL-3.0-or-later
// Cost of storage above the free allowance (M8.6, ADR-086; DECISIONS.md, storage). Like a job's
// cost (cost.ts) it is pure integer arithmetic, so the ledger adds up exactly. Money is whole
// micro-credits (1,000,000 is one credit).

/** Bytes in a GiB, the unit the storage rate is per. */
export const GIB = 1024 ** 3;

/**
 * One day's charge for `usedBytes` stored against an allowance of `freeBytes`: the bytes above
 * the allowance × the rate per GiB per day ÷ GiB, in micro-credits rounded to the nearest one
 * (halves up). 0 at or below the allowance. Exact for any sizes, through BigInt.
 */
export function storageDayCost(usedBytes: number, freeBytes: number, ratePerGibDay: number): number {
  for (const [name, value] of [
    ["used bytes", usedBytes],
    ["free bytes", freeBytes],
    ["rate", ratePerGibDay],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a whole number, 0 or more, not ${value}`);
    }
  }
  if (usedBytes <= freeBytes) return 0;
  const above = BigInt(usedBytes - freeBytes);
  const gib = BigInt(GIB);
  const cost = (above * BigInt(ratePerGibDay) + gib / 2n) / gib;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${usedBytes} bytes at ${ratePerGibDay} per GiB per day is too large to cost exactly`);
  }
  return Number(cost);
}
