// SPDX-License-Identifier: AGPL-3.0-or-later
// Play-money amounts (ADR-033). The API counts whole micro-credits; this writes them as credits
// exactly, with integer arithmetic, so a shown cost is never rounded away. Shared by the web app
// and the API's messages (M8.1).

/** Micro-credits in one credit. */
export const MICRO_CREDITS = 1_000_000;

/** Micro-credits as a credit amount with up to six decimals, for example 833 → "0.000833". */
export function credits(micro: number): string {
  if (!Number.isSafeInteger(micro)) throw new RangeError(`not a whole number of micro-credits: ${micro}`);
  const sign = micro < 0 ? "-" : "";
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO_CREDITS).toLocaleString("en-US");
  const fraction = String(abs % MICRO_CREDITS)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`} ${micro === MICRO_CREDITS ? "credit" : "credits"}`;
}
