// SPDX-License-Identifier: AGPL-3.0-or-later
// A material property against temperature (M5.5, ADR-068): rows of a temperature and a value,
// each column in one unit picked above it. Values are kept as typed, like every quantity; the
// worker converts them to SI. Steady-state thermal and thermal stress runs read the table, a
// linear static run the single value above it.

import { type ExpansionTable, type PropertyTable, type PropertyTableRow, unitsTable } from "@clearfea/spec";
import { useId, useState } from "react";
import { QuantityInput } from "../units/QuantityInput";
import { type QuantityKind, useSystemUnit } from "../units/system";

const MAX_ROWS = 50;

/** One cell's number: reported when the text is a number, null when empty. */
function Cell({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const bad = text.trim() !== "" && !Number.isFinite(Number(text));
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      aria-invalid={bad}
      onChange={(event) => {
        setText(event.target.value);
        const next = event.target.value.trim() === "" ? null : Number(event.target.value);
        if (next === null || Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

function UnitChoice({
  label,
  kind,
  value,
  onChange,
}: {
  label: string;
  kind: QuantityKind;
  value: string;
  onChange: (unit: string) => void;
}) {
  const units = Object.keys(unitsTable.kinds[kind]?.units ?? {});
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {!units.includes(value) && <option value={value}>{value}</option>}
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

export function PropertyTableField<T extends PropertyTable | ExpansionTable>({
  label,
  kind,
  table,
  unit,
  onChange,
  expansion = false,
}: {
  /** The property, as the field above it is labelled ("Young's modulus"). */
  label: string;
  /** Its unit kind; null for Poisson's ratio. */
  kind: QuantityKind | null;
  table: T | null;
  /** The single value's unit, offered for a new table. */
  unit?: string;
  onChange: (table: T | null) => void;
  /** A thermal expansion table, which also needs the temperature its coefficients are measured from. */
  expansion?: boolean;
}) {
  const temperatureUnit = useSystemUnit("temperature");
  const systemUnit = useSystemUnit(kind ?? "temperature");
  const id = useId();
  if (table === null) {
    return (
      <div className="field-actions">
        <button
          type="button"
          onClick={() => {
            const rows: PropertyTableRow[] = [
              { temperature: null, value: null },
              { temperature: null, value: null },
            ];
            const fresh = {
              temperatureUnit,
              ...(kind === null ? {} : { unit: unit ?? systemUnit }),
              rows,
              ...(expansion ? { referenceTemperature: null } : {}),
            };
            onChange(fresh as T);
          }}
        >
          Vary {/^(Young|Poisson)/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)} with temperature
        </button>
      </div>
    );
  }
  const set = (changes: Partial<PropertyTable & ExpansionTable>) => onChange({ ...table, ...changes } as T);
  const setRow = (k: number, row: Partial<PropertyTableRow>) =>
    set({ rows: table.rows.map((r, j) => (j === k ? { ...r, ...row } : r)) });
  // Rows are keyed by position and count, so removing one redraws the cells from the stored values.
  const generation = table.rows.length;
  return (
    <fieldset className="field property-table" aria-labelledby={`${id}-legend`}>
      <legend id={`${id}-legend`}>{label} against temperature</legend>
      <table>
        <thead>
          <tr>
            <th scope="col">
              Temperature{" "}
              <UnitChoice
                label={`${label} table temperature unit`}
                kind="temperature"
                value={table.temperatureUnit}
                onChange={(temperatureUnit) => set({ temperatureUnit })}
              />
            </th>
            <th scope="col">
              {label}{" "}
              {kind !== null && table.unit !== undefined && (
                <UnitChoice label={`${label} table unit`} kind={kind} value={table.unit} onChange={(u) => set({ unit: u })} />
              )}
            </th>
            <th>
              <span className="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, k) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity but their place.
            <tr key={`${generation}-${k}`}>
              <td>
                <Cell label={`Row ${k + 1} temperature`} value={row.temperature} onChange={(temperature) => setRow(k, { temperature })} />
              </td>
              <td>
                <Cell label={`Row ${k + 1} ${label}`} value={row.value} onChange={(value) => setRow(k, { value })} />
              </td>
              <td>
                <button
                  type="button"
                  className="link-button"
                  aria-label={`Remove row ${k + 1}`}
                  onClick={() => set({ rows: table.rows.filter((_, j) => j !== k) })}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {expansion && "referenceTemperature" in table && (
        <QuantityInput
          label="Measured from"
          kind="temperature"
          value={table.referenceTemperature}
          hint="Mean coefficients from this temperature to each row's, as handbooks print them (often 20 °C or 68 °F)."
          onChange={(referenceTemperature) => set({ referenceTemperature })}
        />
      )}
      <span className="field-hint">
        Steady-state thermal and thermal stress runs use this table in place of the value above: linear between rows, and the
        first or last value beyond them. A linear static run uses the value above.
      </span>
      <div className="field-actions">
        <button
          type="button"
          disabled={table.rows.length >= MAX_ROWS}
          onClick={() => set({ rows: [...table.rows, { temperature: null, value: null }] })}
        >
          Add a row
        </button>
        <button type="button" onClick={() => onChange(null)}>
          Remove the table
        </button>
      </div>
    </fieldset>
  );
}
