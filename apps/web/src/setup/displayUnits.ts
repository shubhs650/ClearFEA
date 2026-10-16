// SPDX-License-Identifier: AGPL-3.0-or-later
// The result view's own display units (M3.7, ADR-056): for each quantity kind a result shows,
// the unit the user picked in the Run panel, or none to follow the project's unit system. Results
// are stored in SI and converted on display, so a change redraws them without a rerun. The
// choice is a viewing convenience kept in this browser per user; it changes no stored value and
// nothing the solver sees.

import { systemUnit, unitsTable } from "@clearfea/spec";
import { useCallback, useMemo, useState } from "react";

/** The quantity kinds a result is shown in, in the order the Run panel lists them; the
 * temperature since M5.1. */
export const DISPLAY_KINDS = ["length", "pressure", "force", "moment", "strain", "temperature"] as const;

export type DisplayKind = (typeof DISPLAY_KINDS)[number];

/** The kinds a linear static run shows. */
export const STATIC_KINDS: readonly DisplayKind[] = ["length", "pressure", "force", "moment", "strain"];

/** The kinds a steady-state thermal run shows (M5.1): positions and temperatures. */
export const THERMAL_KINDS: readonly DisplayKind[] = ["length", "temperature"];

/** The unit picked for a kind; a kind left out follows the unit system. */
export type DisplayUnitChoice = Partial<Record<DisplayKind, string>>;

/** The units result figures are shown in, one per kind, plus `ratio` for the safety factor. */
export type ResultUnits = Readonly<Record<DisplayKind | "ratio", string>>;

/** The units of a kind in units.json, in table order. */
export function unitsOf(kind: DisplayKind): string[] {
  return Object.keys(unitsTable.kinds[kind]?.units ?? {});
}

/** The units to show results in: each picked unit, else the unit system's. */
export function resultUnits(system: string, choice: DisplayUnitChoice): ResultUnits {
  const unit = (kind: DisplayKind) => choice[kind] ?? systemUnit(system, kind);
  return {
    length: unit("length"),
    pressure: unit("pressure"),
    force: unit("force"),
    moment: unit("moment"),
    strain: unit("strain"),
    temperature: unit("temperature"),
    ratio: systemUnit(system, "ratio"),
  };
}

/** Keeps only a unit of each display kind that units.json lists; anything else is dropped. */
export function cleanChoice(raw: unknown): DisplayUnitChoice {
  const choice: DisplayUnitChoice = {};
  if (typeof raw !== "object" || raw === null) return choice;
  for (const kind of DISPLAY_KINDS) {
    const unit = (raw as Record<string, unknown>)[kind];
    if (typeof unit === "string" && unitsOf(kind).includes(unit)) choice[kind] = unit;
  }
  return choice;
}

function storageKey(userId: string): string {
  return `clearfea.resultUnits.${userId}`;
}

function load(userId: string | null): DisplayUnitChoice {
  if (userId === null) return {};
  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    return stored === null ? {} : cleanChoice(JSON.parse(stored));
  } catch {
    // Storage blocked or the entry unreadable: follow the unit system.
    return {};
  }
}

function store(userId: string | null, choice: DisplayUnitChoice): void {
  if (userId === null) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

/**
 * The display-unit choice of the signed-in user, its result units under the project's system,
 * and a setter (`null` for a kind goes back to the system's unit).
 */
export function useDisplayUnits(userId: string | null, system: string) {
  const [state, setState] = useState<{ userId: string | null; choice: DisplayUnitChoice }>(() => ({
    userId,
    choice: load(userId),
  }));
  // Another user signed in: read their choice.
  const choice = state.userId === userId ? state.choice : load(userId);
  if (state.userId !== userId) setState({ userId, choice });

  const units = useMemo(() => resultUnits(system, choice), [system, choice]);

  const change = useCallback(
    (kind: DisplayKind, unit: string | null) => {
      setState((current) => {
        const next: DisplayUnitChoice = { ...current.choice };
        if (unit === null) delete next[kind];
        else next[kind] = unit;
        store(userId, next);
        return { userId, choice: next };
      });
    },
    [userId],
  );

  const reset = useCallback(() => {
    store(userId, {});
    setState({ userId, choice: {} });
  }, [userId]);

  return { choice, units, change, reset };
}
