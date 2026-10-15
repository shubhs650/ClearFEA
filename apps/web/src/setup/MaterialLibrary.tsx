// SPDX-License-Identifier: AGPL-3.0-or-later
// Choosing a material from the library or the user's own materials (M2.9, ADR-046). The chosen
// material's values are shown in the project's units with the values as given beside them, and
// its source; "Add this material" copies it into the simulation.

import type { IsotropicMaterial, Quantity } from "@clearfea/spec";
import { useId, useState } from "react";
import { fromSi, toSi } from "../units/convert";
import { type QuantityKind, useSystemUnit } from "../units/system";
import type { MaterialAction, MaterialList } from "./useMaterials";

/** A value in the project's unit, with the value as given when its unit differs. */
function QuantityText({ quantity, kind }: { quantity: Quantity | null | undefined; kind: QuantityKind }) {
  const unit = useSystemUnit(kind);
  if (!quantity) return <>Not given</>;
  if (quantity.unit === unit) return <>{`${quantity.value} ${unit}`}</>;
  const shown = Number(fromSi(toSi(quantity.value, quantity.unit, kind), unit, kind).toPrecision(4));
  return <>{`${shown} ${unit} (given as ${quantity.value} ${quantity.unit})`}</>;
}

export function MaterialValues({ material }: { material: IsotropicMaterial }) {
  return (
    <dl className="geometry-facts material-values" aria-label={`Values of ${material.name}`}>
      <dt>Young's modulus</dt>
      <dd>
        <QuantityText quantity={material.youngsModulus} kind="pressure" />
      </dd>
      <dt>Poisson's ratio</dt>
      <dd>{material.poissonsRatio ?? "Not given"}</dd>
      <dt>Density</dt>
      <dd>
        <QuantityText quantity={material.density} kind="density" />
      </dd>
      <dt>Thermal expansion</dt>
      <dd>
        {material.thermalExpansion ? (
          <QuantityText quantity={material.thermalExpansion} kind="thermalExpansion" />
        ) : (
          "Not given; enter it for a temperature change."
        )}
      </dd>
      <dt>Source</dt>
      <dd>{material.source ?? "Not recorded"}</dd>
    </dl>
  );
}

export function MaterialChooser({
  list,
  onAdd,
  onDelete,
}: {
  list: MaterialList;
  onAdd: (material: IsotropicMaterial) => void;
  onDelete: (material: IsotropicMaterial) => Promise<MaterialAction>;
}) {
  const id = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [action, setAction] = useState<MaterialAction>();
  const [deleting, setDeleting] = useState(false);
  if (list.kind === "loading") return <p className="field-hint">Loading the material library…</p>;
  if (list.kind === "failed") {
    return (
      <p className="field-problem" role="alert">
        {list.problem}
      </p>
    );
  }
  const all = [...list.custom, ...list.library];
  const material = all.find((m) => m.id === chosen) ?? all[0];
  if (material === undefined) return null;
  const custom = list.custom.some((m) => m.id === material.id);
  return (
    <section className="material-chooser" aria-label="Material library">
      <h3 className="pane-subtitle">From the library or your materials</h3>
      <div className="field">
        <label htmlFor={id}>Material</label>
        <select
          id={id}
          value={material.id}
          onChange={(event) => {
            setChosen(event.target.value);
            setAction(undefined);
          }}
        >
          {list.custom.length > 0 && (
            <optgroup label="Your materials">
              {list.custom.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Library">
            {list.library.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <MaterialValues material={material} />
      {!custom && (
        <p className="field-hint">
          Generic values for linear analysis, not minimum or design values. Check them against your material's own data.
        </p>
      )}
      <div className="field-actions">
        <button type="button" onClick={() => onAdd(material)}>
          Add this material
        </button>
        {custom && (
          <button
            type="button"
            className="setup-remove"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              const result = await onDelete(material);
              setDeleting(false);
              setAction(result);
              if (result.kind === "ok") setChosen(null);
            }}
          >
            Delete from your materials
          </button>
        )}
      </div>
      {action && (
        <p className={action.kind === "ok" ? "field-hint" : "field-problem"} role="status">
          {action.kind === "ok" ? action.message : action.problem}
        </p>
      )}
    </section>
  );
}
