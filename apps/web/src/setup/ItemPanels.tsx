// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panels for the setup tree's items (M1.5): a material, a support, a load, and the
// three groups. Each edit produces a whole new spec, which the caller saves.

import {
  type CentrifugalLoad,
  type DisplacementComponent,
  displacementAxes,
  type ForceLoad,
  type GravityLoad,
  type HydrostaticLoad,
  type IsotropicMaterial,
  type Load,
  loadHasFaces,
  loadKinds,
  type PressureLoad,
  type Quantity,
  type RemoteLoad,
  type SimulationSpec,
  type Support,
  supportKinds,
} from "@clearfea/spec";
import { QuantityInput } from "../units/QuantityInput";
import type { QuantityKind } from "../units/system";
import { FacesField, NumberField, TextField } from "./fields";
import {
  assignMaterial,
  type Group,
  type ItemStatus,
  type LoadType,
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

const supportAdds: { type: SupportType; label: string }[] = [
  { type: "fixed", label: "Add a fixed support" },
  { type: "displacement", label: "Add a prescribed displacement" },
  { type: "frictionless", label: "Add a frictionless support" },
];

const loadAdds: { type: LoadType; label: string }[] = [
  { type: "pressure", label: "Add a pressure" },
  { type: "force", label: "Add a force" },
  { type: "remote", label: "Add a remote force and moment" },
  { type: "hydrostatic", label: "Add a hydrostatic pressure" },
  { type: "gravity", label: "Add gravity" },
  { type: "centrifugal", label: "Add a centrifugal load" },
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
  /** Adds an item; for supports and loads, of the type chosen. */
  onAdd: (type?: SupportType | LoadType) => void;
}) {
  const adds = group === "supports" ? supportAdds : group === "loads" ? loadAdds : null;
  return (
    <section className="setup-panel" aria-label={groupTitles[group]}>
      <h2 className="pane-title">{groupTitles[group]}</h2>
      <Notes status={status} />
      {group === "supports" && (
        <p className="field-hint">Select faces in the viewer first to give the new item those faces.</p>
      )}
      {group === "loads" && (
        <p className="field-hint">
          Select faces in the viewer first to give a new pressure, force, remote load or hydrostatic pressure those faces. Gravity and a centrifugal load
          act on every body.
        </p>
      )}
      {adds === null ? (
        <button type="button" onClick={() => onAdd()}>
          Add a material
        </button>
      ) : (
        <div className="field-actions field-actions-column">
          {adds.map(({ type, label }) => (
            <button key={type} type="button" onClick={() => onAdd(type)}>
              {label}
            </button>
          ))}
        </div>
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
      <QuantityInput
        label="Density"
        positive
        kind="density"
        value={material.density ?? null}
        hint="Needed for gravity and centrifugal loads."
        onChange={(density) => set({ density })}
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

/** Three global components of one quantity kind: a force or an acceleration. */
function ComponentsField({
  legend,
  kind,
  values,
  onChange,
}: {
  legend: string;
  kind: QuantityKind;
  values: { x: Quantity | null; y: Quantity | null; z: Quantity | null };
  onChange: (axis: "x" | "y" | "z", value: Quantity | null) => void;
}) {
  return (
    <fieldset className="setup-components">
      <legend>{legend}</legend>
      {displacementAxes.map((axis) => (
        <QuantityInput key={axis} label={axis} kind={kind} value={values[axis]} onChange={(v) => onChange(axis, v)} />
      ))}
    </fieldset>
  );
}

const loadHints: Record<LoadType, string> = {
  pressure: "Uniform and normal to each face. Positive pushes on the face towards the body; negative pulls (suction).",
  force:
    "A total force along the global axes, spread over the faces in proportion to their area (a uniform traction). Enter 0 for a component it does not have.",
  remote:
    "A force and a moment acting at a reference point, carried to the faces they are attached to. The faces stay free to deform, and the force also turns them about the point when it is off their centre. Enter 0 for a component it does not have.",
  hydrostatic:
    "The pressure of a still fluid on the faces: fluid density × gravity × depth below the free surface, and nothing above it. The fluid is outside the body and pushes on the faces towards it. Gravity here acts on the fluid only; add gravity under Loads for the part's own weight.",
  gravity:
    "The acceleration of gravity along the global axes, acting on every body through its density; the weight points along it. For gravity downwards along z, enter z = -1 g.",
  centrifugal:
    "Every body spinning steadily about an axis, pushed outwards by density × angular velocity² × distance from the axis. The sense of rotation does not matter. A setup can have one.",
};

function PressureFields({ load, set }: { load: PressureLoad; set: (changes: Partial<PressureLoad>) => void }) {
  return (
    <QuantityInput label="Magnitude" kind="pressure" value={load.magnitude} onChange={(magnitude) => set({ magnitude })} />
  );
}

function RemoteFields({ load, set }: { load: RemoteLoad; set: (changes: Partial<RemoteLoad>) => void }) {
  return (
    <>
      <ComponentsField
        legend="Reference point (global coordinates)"
        kind="length"
        values={load.point}
        onChange={(axis, value) => set({ point: { ...load.point, [axis]: value } })}
      />
      <ComponentsField
        legend="Force at the point (global axes)"
        kind="force"
        values={load.force}
        onChange={(axis, value) => set({ force: { ...load.force, [axis]: value } })}
      />
      <ComponentsField
        legend="Moment at the point (global axes, right-hand rule)"
        kind="moment"
        values={load.moment}
        onChange={(axis, value) => set({ moment: { ...load.moment, [axis]: value } })}
      />
    </>
  );
}

function HydrostaticFields({
  load,
  set,
}: {
  load: HydrostaticLoad;
  set: (changes: Partial<HydrostaticLoad>) => void;
}) {
  return (
    <>
      <QuantityInput
        label="Fluid density"
        kind="density"
        value={load.fluidDensity}
        onChange={(fluidDensity) => set({ fluidDensity })}
      />
      <ComponentsField
        legend="Gravity on the fluid (global axes; z = -1 g for downwards along z)"
        kind="acceleration"
        values={load.gravity}
        onChange={(axis, value) => set({ gravity: { ...load.gravity, [axis]: value } })}
      />
      <ComponentsField
        legend="A point on the free surface (global coordinates)"
        kind="length"
        values={load.freeSurface}
        onChange={(axis, value) => set({ freeSurface: { ...load.freeSurface, [axis]: value } })}
      />
    </>
  );
}

function CentrifugalFields({
  load,
  set,
}: {
  load: CentrifugalLoad;
  set: (changes: Partial<CentrifugalLoad>) => void;
}) {
  return (
    <>
      <QuantityInput
        label="Angular velocity"
        kind="angularVelocity"
        value={load.angularVelocity}
        onChange={(angularVelocity) => set({ angularVelocity })}
      />
      <ComponentsField
        legend="A point on the axis (global coordinates)"
        kind="length"
        values={load.axisPoint}
        onChange={(axis, value) => set({ axisPoint: { ...load.axisPoint, [axis]: value } })}
      />
      <fieldset className="setup-components">
        <legend>Axis direction (global axes)</legend>
        {displacementAxes.map((axis) => (
          <NumberField
            key={axis}
            label={axis}
            value={load.axisDirection[axis]}
            hint={axis === "x" ? "Any length, for example 0, 0, 1 for the z axis." : undefined}
            onChange={(value) => set({ axisDirection: { ...load.axisDirection, [axis]: value } })}
          />
        ))}
      </fieldset>
    </>
  );
}

export function LoadPanel({
  spec,
  load,
  status,
  selection,
  onChange,
}: {
  spec: SimulationSpec;
  load: Load;
  status: ItemStatus | undefined;
  selection: ReadonlySet<number>;
  onChange: (spec: SimulationSpec) => void;
}) {
  const set = (changes: Partial<Load>) => onChange(updateLoad(spec, { ...load, ...changes } as Load));
  const title = loadKinds[load.type];
  return (
    <section className="setup-panel" aria-label={title}>
      <h2 className="pane-title">{title}</h2>
      <Notes status={status} />
      <TextField label="Name" value={load.name} onChange={(name) => set({ name })} />
      <p className="field-hint">{loadHints[load.type]}</p>
      {load.type === "pressure" && <PressureFields load={load} set={set} />}
      {(load.type === "force" || load.type === "gravity") && (
        <ComponentsField
          legend={load.type === "force" ? "Force (global axes)" : "Acceleration of gravity (global axes)"}
          kind={load.type === "force" ? "force" : "acceleration"}
          values={load as ForceLoad | GravityLoad}
          onChange={(axis, value) => set({ [axis]: value } as Partial<Load>)}
        />
      )}
      {load.type === "remote" && <RemoteFields load={load} set={set} />}
      {load.type === "hydrostatic" && <HydrostaticFields load={load} set={set} />}
      {load.type === "centrifugal" && <CentrifugalFields load={load} set={set} />}
      {loadHasFaces(load) && (
        <FacesField faces={load.faces} selection={selection} onChange={(faces) => set({ faces })} />
      )}
      <Remove what={title.toLowerCase()} onRemove={() => onChange(removeItem(spec, load.id))} />
    </section>
  );
}
