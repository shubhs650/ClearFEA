// SPDX-License-Identifier: AGPL-3.0-or-later
// Input fields for the setup panels. A number field keeps what the user types and reports a
// value only when the text is a number (or empty, which is null), so a half-typed "1e" never
// reaches the spec. Physical values use the shared QuantityInput in ../units/ (M2.1).

import type { BodyAssignment } from "@clearfea/spec";
import { useId, useState } from "react";

function parse(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

const NOT_A_NUMBER = "Enter a number, for example 210 or 2.1e5.";

/** Values above `above` and below `below`, or up to and including it with `orEqual` (M5.2). */
type Bounds = { above: number; below: number; orEqual?: boolean };

function inside(value: number, range: Bounds): boolean {
  return value > range.above && (range.orEqual ? value <= range.below : value < range.below);
}

/** The value a field's text stands for, or the problem with it. Empty text is null. */
function check(text: string, range?: Bounds, whole = false): { value: number | null } | { problem: string } {
  const parsed = parse(text);
  if (parsed === undefined) return { problem: NOT_A_NUMBER };
  if (whole && parsed !== null && !Number.isInteger(parsed)) return { problem: "Enter a whole number, for example 10." };
  if (parsed !== null && range && !inside(parsed, range)) {
    return {
      problem:
        range.below === Number.POSITIVE_INFINITY
          ? `Enter a value greater than ${range.above}.`
          : range.orEqual
            ? `Enter a value above ${range.above} and at most ${range.below}.`
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
  whole = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  /** Exclusive bounds; a value outside them is shown as a problem and not reported. */
  range?: Bounds;
  /** Whole numbers only (M6.1: the number of modes). */
  whole?: boolean;
}) {
  const [text, setText] = useState(show(value));
  const checked = check(text, range, whole);
  const problem = "problem" in checked ? checked.problem : undefined;
  const hintId = useId();
  return (
    <div className="field">
      <label htmlFor={`${hintId}-value`}>{label}</label>
      <input
        id={`${hintId}-value`}
        inputMode={whole ? "numeric" : "decimal"}
        value={text}
        aria-invalid={problem !== undefined}
        aria-describedby={hint || problem ? hintId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = check(event.target.value, range, whole);
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
  return <TagsField tags={faces} selection={selection} onChange={onChange} noun={{ label: "Faces", one: "face", many: "faces" }} />;
}

/** Faces or edges of an item (M2.8 adds edges), and buttons that take them from the viewer's selection. */
export function TagsField({
  tags,
  selection,
  onChange,
  noun,
}: {
  tags: readonly number[];
  selection: ReadonlySet<number>;
  onChange: (tags: number[]) => void;
  noun: { label: string; one: string; many: string };
}) {
  const picked = [...selection].sort((a, b) => a - b);
  const same = picked.length === tags.length && picked.every((tag) => tags.includes(tag));
  return (
    <div className="field">
      <span>{noun.label}</span>
      <span className={tags.length === 0 ? "field-hint" : undefined}>
        {tags.length === 0
          ? `None yet. Click ${noun.many} in the viewer, then use them here.`
          : [...tags].sort((a, b) => a - b).join(", ")}
      </span>
      <div className="field-actions">
        <button type="button" disabled={picked.length === 0 || same} onClick={() => onChange(picked)}>
          {picked.length < 2 ? `Use the selected ${noun.one}` : `Use the ${picked.length} selected ${noun.many}`}
        </button>
        <button type="button" disabled={tags.length === 0} onClick={() => onChange([])}>
          Remove all {noun.many}
        </button>
      </div>
    </div>
  );
}

/** Tick boxes for the bodies of the setup (M2.8; heat generation's bodies, M5.2). */
export function BodiesField({
  bodies,
  tags,
  onChange,
}: {
  bodies: readonly BodyAssignment[];
  tags: readonly number[];
  onChange: (tags: number[]) => void;
}) {
  return (
    <fieldset className="field">
      <legend>Bodies</legend>
      {bodies.map((body) => (
        <label key={body.tag} className="checkbox">
          <input
            type="checkbox"
            checked={tags.includes(body.tag)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...tags, body.tag].sort((a, b) => a - b)
                  : tags.filter((tag) => tag !== body.tag),
              )
            }
          />
          Body {body.tag}
        </label>
      ))}
    </fieldset>
  );
}
