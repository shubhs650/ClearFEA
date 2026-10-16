// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings panels for the setup tree's items (M1.5): a material, a support, a load, and the
// three groups; from M5.1 also the analysis type. Each edit produces a whole new spec, which the
// caller saves.

import {
  type AnalysisType,
  analysisKinds,
  analysisLoads,
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
import { type ReactNode, useState } from "react";
import { QuantityInput } from "../units/QuantityInput";
import type { QuantityKind } from "../units/system";
import { BodiesField, FacesField, NumberField, TextField } from "./fields";
import {
  assignMaterial,
  editMaterial,
  type Group,
  type ItemStatus,
  type LoadType,
  removeItem,
  type SupportType,
  setAnalysis,
  updateLoad,
  updateSupport,
} from "./spec";
import type { MaterialAction } from "./useMaterials";

const groupTitles: Record<Group, string> = {
  materials: "Materials",
  supports: "Supports",
  loads: "Loads",
};

const supportAdds: { type: SupportType; label: string }[] = [
  { type: "fixed", label: "Add a fixed support" },
  { type: "displacement", label: "Add a prescribed displacement" },
  { type: "frictionless", label: "Add a frictionless support" },
  { type: "elastic", label: "Add an elastic support" },
];

const loadAdds: { type: LoadType; label: string }[] = [
  { type: "pressure", label: "Add a pressure" },
  { type: "force", label: "Add a force" },
  { type: "remote", label: "Add a remote force and moment" },
  { type: "hydrostatic", label: "Add a hydrostatic pressure" },
  { type: "gravity", label: "Add gravity" },
  { type: "centrifugal", label: "Add a centrifugal load" },
  { type: "temperature", label: "Add a temperature change" },
  { type: "fixed_temperature", label: "Add a fixed temperature" },
  { type: "heat_flux", label: "Add a heat flux" },
  { type: "convection", label: "Add convection" },
  { type: "radiation", label: "Add radiation" },
  { type: "heat_generation", label: "Add heat generation" },
];

/** What each analysis type does, in one line (M5.1). */
const analysisHints: Record<AnalysisType, string> = {
  linear_static: "Small displacements of linear elastic bodies under supports and loads: displacements, stresses and reactions.",
  steady_thermal:
    "Steady-state heat conduction: temperatures from fixed temperatures, heat fluxes, convection and radiation on faces and heat generated in bodies; faces with none of them are insulated.",
};

/**
 * The analysis type (M5.1, ADR-064). Changing it changes only the spec's analysis; supports and
 * loads that do not belong to the new type stay and are marked until deleted.
 */
export function AnalysisPanel({
  spec,
  status,
  onChange,
}: {
  spec: SimulationSpec;
  status: ItemStatus | undefined;
  onChange: (spec: SimulationSpec) => void;
}) {
  return (
    <section className="setup-panel" aria-label="Analysis">
      <h2 className="pane-title">Analysis</h2>
      <Notes status={status} />
      <fieldset className="setup-components">
        <legend>Analysis type</legend>
        {(Object.keys(analysisKinds) as AnalysisType[]).map((analysis) => (
          <div key={analysis}>
            <label className="checkbox">
              <input
                type="radio"
                name="analysis"
                value={analysis}
                checked={spec.analysis === analysis}
                onChange={() => onChange(setAnalysis(spec, analysis))}
              />
              {analysisKinds[analysis]}
            </label>
            <p className="field-hint">{analysisHints[analysis]}</p>
          </div>
        ))}
      </fieldset>
    </section>
  );
}

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
  analysis = "linear_static",
  onAdd,
  children,
}: {
  group: Group;
  status: ItemStatus | undefined;
  /** The setup's analysis type (M5.1): it decides which supports and loads are offered. */
  analysis?: AnalysisType;
  /** Adds an item; for supports and loads, of the type chosen. */
  onAdd: (type?: SupportType | LoadType) => void;
  /** Shown below the add buttons: the material library for Materials. */
  children?: ReactNode;
}) {
  const thermal = analysis === "steady_thermal";
  // Supports belong to a linear static analysis only (ADR-064).
  const adds =
    group === "supports"
      ? thermal
        ? []
        : supportAdds
      : group === "loads"
        ? loadAdds.filter(({ type }) => analysisLoads[analysis].includes(type))
        : null;
  return (
    <section className="setup-panel" aria-label={groupTitles[group]}>
      <h2 className="pane-title">{groupTitles[group]}</h2>
      <Notes status={status} />
      {group === "supports" &&
        (thermal ? (
          <p className="field-hint">
            Supports have no effect in a steady-state thermal analysis. Delete them, or set the analysis type to linear
            static.
          </p>
        ) : (
          <p className="field-hint">Select faces in the viewer first to give the new item those faces.</p>
        ))}
      {group === "loads" &&
        (thermal ? (
          <p className="field-hint">
            Select faces in the viewer first to give a new fixed temperature, heat flux, convection or radiation those faces. Heat
            generation acts on the bodies you tick. Every body needs a fixed temperature, convection or radiation.
          </p>
        ) : (
          <p className="field-hint">
            Select faces in the viewer first to give a new pressure, force, remote load or hydrostatic pressure those faces. Gravity, a centrifugal load and
            a temperature change act on every body.
          </p>
        ))}
      {adds === null ? (
        <button type="button" onClick={() => onAdd()}>
          Add an empty material
        </button>
      ) : adds.length === 0 ? null : (
        <div className="field-actions field-actions-column">
          {adds.map(({ type, label }) => (
            <button key={type} type="button" onClick={() => onAdd(type)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {children}
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
  onSave,
  bodyLabels,
}: {
  spec: SimulationSpec;
  material: IsotropicMaterial;
  /** What each body is called (M4.1): its part name, or "Body <tag>". */
  bodyLabels?: ReadonlyMap<number, string>;
  status: ItemStatus | undefined;
  onChange: (spec: SimulationSpec) => void;
  /** Keeps a copy among the user's own materials (M2.9). */
  onSave: (material: IsotropicMaterial) => Promise<MaterialAction>;
}) {
  const set = (changes: Partial<IsotropicMaterial>) => onChange(editMaterial(spec, material, changes));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<MaterialAction>();
  const complete = material.youngsModulus !== null && material.poissonsRatio !== null;
  return (
    <section className="setup-panel" aria-label="Material">
      <h2 className="pane-title">Material</h2>
      <Notes status={status} />
      <TextField label="Name" value={material.name} onChange={(name) => set({ name })} />
      <p className="field-hint">Linear elastic, isotropic.</p>
      {material.source && <p className="field-hint">Values from {material.source}</p>}
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
      <QuantityInput
        label="Thermal expansion"
        kind="thermalExpansion"
        value={material.thermalExpansion ?? null}
        hint="Coefficient of linear thermal expansion, for example 12e-6 1/°C for steel. Needed for a temperature change."
        onChange={(thermalExpansion) => set({ thermalExpansion })}
      />
      <QuantityInput
        label="Thermal conductivity"
        positive
        kind="thermalConductivity"
        value={material.thermalConductivity ?? null}
        hint="For example 45 W/(m·K) for carbon steel. Needed for a steady-state thermal analysis."
        onChange={(thermalConductivity) => set({ thermalConductivity })}
      />
      <QuantityInput
        label="Yield strength"
        positive
        kind="pressure"
        value={material.yieldStrength ?? null}
        hint="Tensile yield strength. The result shows the safety factor against yield when every material has one."
        onChange={(yieldStrength) => set({ yieldStrength })}
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
              {bodyLabels?.get(body.tag) ?? `Body ${body.tag}`}
              {other && otherName !== undefined && <span className="field-hint"> (now {otherName})</span>}
            </label>
          );
        })}
      </fieldset>
      <div className="field-actions">
        <button
          type="button"
          disabled={!complete || saving}
          onClick={async () => {
            setSaving(true);
            setSaved(await onSave(material));
            setSaving(false);
          }}
        >
          Save to my materials
        </button>
      </div>
      {saved ? (
        <p className={saved.kind === "ok" ? "field-hint" : "field-problem"} role="status">
          {saved.kind === "ok" ? saved.message : saved.problem}
        </p>
      ) : (
        <p className="field-hint">
          {complete
            ? "Keeps a copy you can add to any of your simulations."
            : "Enter Young's modulus and Poisson's ratio to save it to your materials."}
        </p>
      )}
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
  elastic:
    "The faces rest on an elastic foundation that pushes back along their normals with a pressure of stiffness × normal displacement, both ways (it does not lift off). It does not stop the faces sliding, so the part may need other supports too.",
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
      {support.type === "elastic" && (
        <QuantityInput
          label="Foundation stiffness"
          kind="foundationStiffness"
          value={support.stiffness}
          onChange={(stiffness) => set({ stiffness } as Partial<Support>)}
        />
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
  temperature:
    "Every body warms (positive) or cools (negative) by the same amount from the temperature at which it is free of stress. Each material expands by its thermal expansion × the change, and the supports resist it. A setup can have one.",
  fixed_temperature:
    "Holds every node of the faces at this temperature. Faces with no thermal load are insulated: no heat crosses them.",
  heat_flux:
    "Heat crossing the faces, the same per unit area everywhere: positive into the body, negative out of it. Heat fluxes on the same face add up.",
  convection:
    "Heat leaving the faces to a surrounding fluid: coefficient × (surface temperature − ambient temperature) per unit area. One convection per face.",
  radiation:
    "Heat leaving the faces to surroundings at the ambient temperature: emissivity × Stefan–Boltzmann constant × (surface temperature⁴ − ambient temperature⁴) per unit area. Each face sees only the surroundings, not other faces. One radiation per face.",
  heat_generation:
    "Heat produced inside the bodies, the same per unit volume everywhere (for example from an electric current): negative for heat absorbed.",
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
      {load.type === "temperature" && (
        <QuantityInput
          label="Change"
          kind="temperatureDifference"
          value={load.change}
          onChange={(change) => set({ change })}
        />
      )}
      {load.type === "fixed_temperature" && (
        <QuantityInput
          label="Temperature"
          kind="temperature"
          value={load.temperature}
          onChange={(temperature) => set({ temperature })}
        />
      )}
      {load.type === "heat_flux" && (
        <QuantityInput label="Heat flux" kind="heatFlux" value={load.flux} onChange={(flux) => set({ flux })} />
      )}
      {load.type === "convection" && (
        <QuantityInput
          label="Convection coefficient"
          positive
          kind="heatTransferCoefficient"
          value={load.coefficient}
          hint="For example 10 W/(m²·K) for still air, 1000 W/(m²·K) for flowing water."
          onChange={(coefficient) => set({ coefficient })}
        />
      )}
      {load.type === "radiation" && (
        <NumberField
          label="Emissivity"
          value={load.emissivity}
          hint="Above 0 and at most 1, for example 0.8 for oxidised steel."
          range={{ above: 0, below: 1, orEqual: true }}
          onChange={(emissivity) => set({ emissivity })}
        />
      )}
      {(load.type === "convection" || load.type === "radiation") && (
        <QuantityInput
          label="Ambient temperature"
          kind="temperature"
          value={load.ambientTemperature}
          onChange={(ambientTemperature) => set({ ambientTemperature })}
        />
      )}
      {load.type === "heat_generation" && (
        <>
          <QuantityInput label="Heat per volume" kind="heatGeneration" value={load.power} onChange={(power) => set({ power })} />
          <BodiesField bodies={spec.bodies} tags={load.bodies} onChange={(bodies) => set({ bodies })} />
        </>
      )}
      {loadHasFaces(load) && (
        <FacesField faces={load.faces} selection={selection} onChange={(faces) => set({ faces })} />
      )}
      <Remove what={title.toLowerCase()} onRemove={() => onChange(removeItem(spec, load.id))} />
    </section>
  );
}
