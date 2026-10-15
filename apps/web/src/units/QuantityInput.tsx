// SPDX-License-Identifier: AGPL-3.0-or-later
// The one input for a physical value (ARCHITECTURE.md section 9, M2.1): a number field and a
// unit choice limited to the units of the field's kind in packages/spec/units.json. While no
// unit has been chosen it offers the project system's unit, and follows the system when that
// changes. The value is reported as typed ({ value, unit }) and never converted here; the
// worker converts it to SI for the solver (ARCHITECTURE.md section 5).

import { type Quantity, unitsTable } from "@clearfea/spec";
import { useId, useState } from "react";
import { type QuantityKind, useSystemUnit } from "./system";

const NOT_A_NUMBER = "Enter a number, for example 210 or 2.1e5.";

/** The value the text stands for, or the problem with it. Empty text is null. */
function check(text: string, positive: boolean): { value: number | null } | { problem: string } {
  if (text.trim() === "") return { value: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { problem: NOT_A_NUMBER };
  if (positive && !(value > 0)) return { problem: "Enter a value greater than 0." };
  return { value };
}

export function QuantityInput({
  label,
  kind,
  value,
  onChange,
  hint,
  positive = false,
}: {
  label: string;
  kind: QuantityKind;
  value: Quantity | null;
  onChange: (value: Quantity | null) => void;
  hint?: string;
  /** Only values greater than zero are reported. */
  positive?: boolean;
}) {
  const units = Object.keys(unitsTable.kinds[kind]?.units ?? {});
  const systemDefault = useSystemUnit(kind);
  const [text, setText] = useState(value === null ? "" : String(value.value));
  // A unit picked while the field is empty; until then the system's unit is offered.
  const [picked, setPicked] = useState<string | null>(null);
  const unit = value?.unit ?? picked ?? systemDefault;
  const checked = check(text, positive);
  const problem = "problem" in checked ? checked.problem : undefined;
  const hintId = useId();
  const commit = (nextText: string, nextUnit: string) => {
    const next = check(nextText, positive);
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
            setPicked(event.target.value);
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

/** A choice of the project's unit system. */
export function UnitSystemField({
  value,
  onChange,
  systems,
  disabled = false,
  problem,
}: {
  value: string;
  onChange: (system: string) => void;
  systems: readonly { id: string; name: string }[];
  disabled?: boolean;
  problem?: string;
}) {
  const id = useId();
  return (
    <div className="field unit-system">
      <label htmlFor={id}>Unit system</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      >
        {systems.map((system) => (
          <option key={system.id} value={system.id}>
            {system.name}
          </option>
        ))}
      </select>
      <span id={`${id}-hint`} className={problem ? "field-problem" : "field-hint"} role={problem ? "alert" : undefined}>
        {problem ?? "Units offered first and used for results. Values keep the unit they were entered in."}
      </span>
    </div>
  );
}
