// SPDX-License-Identifier: AGPL-3.0-or-later
// Input fields for the setup panels. A number field keeps what the user types and reports a
// value only when the text is a number (or empty, which is null), so a half-typed "1e" never
// reaches the spec. The quantity field is a stand-in for M2.1's shared quantity input:
// a number and a unit of the field's kind, stored as typed ({ value, unit }), never converted.

import { type Quantity, unitsTable } from "@clearfea/spec";
import { useId, useState } from "react";

function parse(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

const NOT_A_NUMBER = "Enter a number, for example 210 or 2.1e5.";

type Bounds = { above: number; below: number };

/** The value a field's text stands for, or the problem with it. Empty text is null. */
function check(text: string, range?: Bounds): { value: number | null } | { problem: string } {
  const parsed = parse(text);
  if (parsed === undefined) return { problem: NOT_A_NUMBER };
  if (parsed !== null && range && !(parsed > range.above && parsed < range.below)) {
    return {
      problem:
        range.below === Number.POSITIVE_INFINITY
          ? `Enter a value greater than ${range.above}.`
          : `Enter a value above ${range.above} and below ${range.below}.`,
    };
  }
  return { value: parsed };
}

function show(value: number | null): string {
  return value === null ? "" : String(value);
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  range,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  /** Exclusive bounds; a value outside them is shown as a problem and not reported. */
  range?: Bounds;
}) {
  const [text, setText] = useState(show(value));
  const checked = check(text, range);
  const problem = "problem" in checked ? checked.problem : undefined;
  const hintId = useId();
  return (
    <div className="field">
      <label htmlFor={`${hintId}-value`}>{label}</label>
      <input
        id={`${hintId}-value`}
        inputMode="decimal"
        value={text}
        aria-invalid={problem !== undefined}
        aria-describedby={hint || problem ? hintId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = check(event.target.value, range);
          if ("value" in next) onChange(next.value);
        }}
      />
      {(hint || problem) && (
        <span id={hintId} className={problem ? "field-problem" : "field-hint"}>
          {problem ?? hint}
        </span>
      )}
    </div>
  );
}

export function QuantityField({
  label,
  kind,
  value,
  defaultUnit,
  onChange,
  hint,
  positive = false,
}: {
  label: string;
  kind: "length" | "pressure";
  value: Quantity | null;
  /** The unit offered while no value is entered. */
  defaultUnit: string;
  onChange: (value: Quantity | null) => void;
  hint?: string;
  /** Only values greater than zero are reported. */
  positive?: boolean;
}) {
  const units = Object.keys(unitsTable.kinds[kind]?.units ?? {});
  const [text, setText] = useState(show(value?.value ?? null));
  const [unit, setUnit] = useState(value?.unit ?? defaultUnit);
  const range = positive ? { above: 0, below: Number.POSITIVE_INFINITY } : undefined;
  const checked = check(text, range);
  const problem = "problem" in checked ? checked.problem : undefined;
  const hintId = useId();
  const commit = (nextText: string, nextUnit: string) => {
    const next = check(nextText, range);
    if ("value" in next) onChange(next.value === null ? null : { value: next.value, unit: nextUnit });
  };
  return (
    <div className="field">
      <label htmlFor={`${hintId}-value`}>{label}</label>
      <div className="quantity">
        <input
          id={`${hintId}-value`}
          inputMode="decimal"
          value={text}
          aria-invalid={problem !== undefined}
          aria-describedby={hint || problem ? hintId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            commit(event.target.value, unit);
          }}
        />
        <select
          aria-label={`${label} unit`}
          value={unit}
          onChange={(event) => {
            setUnit(event.target.value);
            commit(text, event.target.value);
          }}
        >
          {/* A stored unit the table no longer lists stays visible, so the error mark can name it. */}
          {!units.includes(unit) && <option value={unit}>{unit}</option>}
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {(hint || problem) && (
        <span id={hintId} className={problem ? "field-problem" : "field-hint"}>
          {problem ?? hint}
        </span>
      )}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const empty = text.trim() === "";
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={text}
        maxLength={100}
        aria-invalid={empty}
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value.trim() !== "") onChange(event.target.value.trim());
        }}
      />
      {empty && <span className="field-problem">Enter a name.</span>}
    </div>
  );
}

/** The faces of a support or load, and buttons that take them from the viewer's selection. */
export function FacesField({
  faces,
  selection,
  onChange,
}: {
  faces: readonly number[];
  selection: ReadonlySet<number>;
  onChange: (faces: number[]) => void;
}) {
  const picked = [...selection].sort((a, b) => a - b);
  const same = picked.length === faces.length && picked.every((tag) => faces.includes(tag));
  return (
    <div className="field">
      <span>Faces</span>
      <span className={faces.length === 0 ? "field-hint" : undefined}>
        {faces.length === 0
          ? "None yet. Click faces in the viewer, then use them here."
          : [...faces].sort((a, b) => a - b).join(", ")}
      </span>
      <div className="field-actions">
        <button type="button" disabled={picked.length === 0 || same} onClick={() => onChange(picked)}>
          {picked.length < 2 ? "Use the selected face" : `Use the ${picked.length} selected faces`}
        </button>
        <button type="button" disabled={faces.length === 0} onClick={() => onChange([])}>
          Remove all faces
        </button>
      </div>
    </div>
  );
}
