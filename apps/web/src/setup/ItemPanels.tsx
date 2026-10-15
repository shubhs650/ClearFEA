// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panels for the setup tree's items (M1.5): a material, a fixed support, a pressure,
// and the three groups. Each edit produces a whole new spec, which the caller saves.

import {
  type DisplacementComponent,
  displacementAxes,
  type IsotropicMaterial,
  type PressureLoad,
  type SimulationSpec,
  type Support,
  supportKinds,
} from "@clearfea/spec";
import { QuantityInput } from "../units/QuantityInput";
import { FacesField, NumberField, TextField } from "./fields";
import {
  assignMaterial,
  type Group,
  type ItemStatus,
  removeItem,
  type SupportType,
  updateLoad,
  updateMaterial,
  updateSupport,
} from "./spec";

const groupTitles: Record<Group, string> = {
  materials: "Materials",
  supports: "Supports",
  loads: "Loads",
};

const addLabels: Record<Group, string> = {
  materials: "Add a material",
  supports: "Add a fixed support",
  loads: "Add a pressure",
};

const supportAdds: { type: SupportType; label: string }[] = [
  { type: "fixed", label: "Add a fixed support" },
  { type: "displacement", label: "Add a prescribed displacement" },
  { type: "frictionless", label: "Add a frictionless support" },
];

export function Notes({ status }: { status: ItemStatus | undefined }) {
  if (status === undefined || status.notes.length === 0) return null;
  return (
    <ul className={`setup-notes setup-notes-${status.mark}`} aria-label="What this item needs">
      {status.notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

export function GroupPanel({
  group,
  status,
  onAdd,
}: {
  group: Group;
  status: ItemStatus | undefined;
  /** Adds an item; for supports, of the type chosen. */
  onAdd: (type?: SupportType) => void;
}) {
  return (
    <section className="setup-panel" aria-label={groupTitles[group]}>
      <h2 className="pane-title">{groupTitles[group]}</h2>
      <Notes status={status} />
      {(group === "supports" || group === "loads") && (
        <p className="field-hint">Select faces in the viewer first to give the new item those faces.</p>
      )}
      {group === "supports" ? (
        <div className="field-actions field-actions-column">
          {supportAdds.map(({ type, label }) => (
            <button key={type} type="button" onClick={() => onAdd(type)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <button type="button" onClick={() => onAdd()}>
          {addLabels[group]}
        </button>
      )}
    </section>
  );
}

function Remove({ onRemove, what }: { onRemove: () => void; what: string }) {
  return (
    <button type="button" className="setup-remove" onClick={onRemove}>
      Delete {what}
    </button>
  );
}

export function MaterialPanel({
  spec,
  material,
  status,
  onChange,
}: {
  spec: SimulationSpec;
  material: IsotropicMaterial;
  status: ItemStatus | undefined;
  onChange: (spec: SimulationSpec) => void;
}) {
  const set = (changes: Partial<IsotropicMaterial>) => onChange(updateMaterial(spec, { ...material, ...changes }));
  return (
    <section className="setup-panel" aria-label="Material">
      <h2 className="pane-title">Material</h2>
      <Notes status={status} />
      <TextField label="Name" value={material.name} onChange={(name) => set({ name })} />
      <p className="field-hint">Linear elastic, isotropic.</p>
      <QuantityInput
        label="Young's modulus"
        positive
        kind="pressure"
        value={material.youngsModulus}
        onChange={(youngsModulus) => set({ youngsModulus })}
      />
      <NumberField
        label="Poisson's ratio"
        value={material.poissonsRatio}
        hint="Between -1 and 0.5, for example 0.3."
        range={{ above: -1, below: 0.5 }}
        onChange={(poissonsRatio) => set({ poissonsRatio })}
      />
      <fieldset className="setup-bodies">
        <legend>Bodies made of this material</legend>
        {spec.bodies.map((body) => {
          const other = body.material !== null && body.material !== material.id;
          const otherName = spec.materials.find((m) => m.id === body.material)?.name;
          return (
            <label key={body.tag} className="checkbox">
              <input
                type="checkbox"
                checked={body.material === material.id}
                onChange={(event) =>
                  onChange(assignMaterial(spec, body.tag, event.target.checked ? material.id : null))
                }
              />
              Body {body.tag}
              {other && otherName !== undefined && <span className="field-hint"> (now {otherName})</span>}
            </label>
          );
        })}
      </fieldset>
      <Remove what="material" onRemove={() => onChange(removeItem(spec, material.id))} />
    </section>
  );
}

const supportHints: Record<SupportType, string> = {
  fixed: "Holds every displacement component of the faces at zero.",
  displacement:
    "Moves the faces by the given amounts along the global x, y and z axes. 0 holds a direction; a free one is left to the solution.",
  frictionless:
    "Holds each flat face against moving along its normal and lets it slide in its plane, both ways (it does not lift off). Use it on symmetry planes.",
};

/** One global component of a prescribed displacement: free, or a length. */
function ComponentField({
  axis,
  value,
  onChange,
}: {
  axis: string;
  value: DisplacementComponent;
  onChange: (value: DisplacementComponent) => void;
}) {
  const free = value === "free";
  return (
    <div className="component-field">
      <label className="checkbox">
        <input type="checkbox" checked={free} onChange={(event) => onChange(event.target.checked ? "free" : null)} />
        {axis} free
      </label>
      {!free && (
        <QuantityInput label={`${axis} displacement`} kind="length" value={value} onChange={(next) => onChange(next)} />
      )}
    </div>
  );
}

export function SupportPanel({
  spec,
  support,
  status,
  selection,
  onChange,
}: {
  spec: SimulationSpec;
  support: Support;
  status: ItemStatus | undefined;
  selection: ReadonlySet<number>;
  onChange: (spec: SimulationSpec) => void;
}) {
  const set = (changes: Partial<Support>) => onChange(updateSupport(spec, { ...support, ...changes } as Support));
  const title = supportKinds[support.type];
  return (
    <section className="setup-panel" aria-label={title}>
      <h2 className="pane-title">{title}</h2>
      <Notes status={status} />
      <TextField label="Name" value={support.name} onChange={(name) => set({ name })} />
      <p className="field-hint">{supportHints[support.type]}</p>
      {support.type === "displacement" && (
        <fieldset className="setup-components">
          <legend>Displacement (global axes)</legend>
          {displacementAxes.map((axis) => (
            <ComponentField
              key={axis}
              axis={axis}
              value={support[axis]}
              onChange={(value) => set({ [axis]: value } as Partial<Support>)}
            />
          ))}
        </fieldset>
      )}
      <FacesField faces={support.faces} selection={selection} onChange={(faces) => set({ faces })} />
      <Remove what="support" onRemove={() => onChange(removeItem(spec, support.id))} />
    </section>
  );
}

export function PressurePanel({
  spec,
  load,
  status,
  selection,
  onChange,
}: {
  spec: SimulationSpec;
  load: PressureLoad;
  status: ItemStatus | undefined;
  selection: ReadonlySet<number>;
  onChange: (spec: SimulationSpec) => void;
}) {
  const set = (changes: Partial<PressureLoad>) => onChange(updateLoad(spec, { ...load, ...changes }));
  return (
    <section className="setup-panel" aria-label="Pressure">
      <h2 className="pane-title">Pressure</h2>
      <Notes status={status} />
      <TextField label="Name" value={load.name} onChange={(name) => set({ name })} />
      <QuantityInput
        label="Magnitude"
        kind="pressure"
        value={load.magnitude}
        hint="Uniform and normal to each face. Positive pushes on the face towards the body; negative pulls (suction)."
        onChange={(magnitude) => set({ magnitude })}
      />
      <FacesField faces={load.faces} selection={selection} onChange={(faces) => set({ faces })} />
      <Remove what="pressure" onRemove={() => onChange(removeItem(spec, load.id))} />
    </section>
  );
}
