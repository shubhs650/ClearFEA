// SPDX-License-Identifier: AGPL-3.0-or-later
// The bodies of the setup (M4.1, ADR-058): every body of the geometry by its part name, each made
// of one material picked from the simulation's materials. Opening a body selects its faces in the
// viewer, so the user can see which part it is.

import type { SimulationSpec } from "@clearfea/spec";
import { Notes } from "./ItemPanels";
import { assignMaterial, bodyItem, type ItemStatus } from "./spec";

function MaterialSelect({
  spec,
  tag,
  label,
  id,
  onChange,
}: {
  spec: SimulationSpec;
  tag: number;
  /** The body's label, for the accessible name of the list. */
  label: string;
  id: string;
  onChange: (spec: SimulationSpec) => void;
}) {
  const material = spec.bodies.find((b) => b.tag === tag)?.material ?? null;
  return (
    <select
      id={id}
      aria-label={`Material of ${label}`}
      value={material ?? ""}
      disabled={spec.materials.length === 0}
      onChange={(event) => onChange(assignMaterial(spec, tag, event.target.value === "" ? null : event.target.value))}
    >
      <option value="">{spec.materials.length === 0 ? "No materials yet" : "Pick a material"}</option>
      {spec.materials.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

export function BodiesPanel({
  spec,
  labels,
  status,
  onChange,
  onOpen,
}: {
  spec: SimulationSpec;
  labels: ReadonlyMap<number, string>;
  status: ItemStatus | undefined;
  onChange: (spec: SimulationSpec) => void;
  /** Opens a tree item: a body, or Materials. */
  onOpen: (item: string) => void;
}) {
  return (
    <section className="setup-panel" aria-label="Bodies">
      <h2 className="pane-title">Bodies</h2>
      <Notes status={status} />
      <p className="field-hint">
        Each body is made of one material.
        {spec.materials.length === 0 && " Add materials under Materials first."} Open a body to see it selected in the
        viewer.
      </p>
      <table className="setup-bodies-table">
        <thead>
          <tr>
            <th scope="col">Body</th>
            <th scope="col">Material</th>
          </tr>
        </thead>
        <tbody>
          {spec.bodies.map((body) => {
            const label = labels.get(body.tag) ?? `Body ${body.tag}`;
            return (
              <tr key={body.tag}>
                <th scope="row">
                  <button type="button" className="link-button" onClick={() => onOpen(bodyItem(body.tag))}>
                    {label}
                  </button>
                </th>
                <td>
                  <MaterialSelect spec={spec} tag={body.tag} label={label} id={`body-material-${body.tag}`} onChange={onChange} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {spec.materials.length === 0 && (
        <div className="field-actions">
          <button type="button" onClick={() => onOpen("materials")}>
            Open Materials
          </button>
        </div>
      )}
    </section>
  );
}

export function BodyPanel({
  spec,
  tag,
  name,
  label,
  faces,
  status,
  onChange,
  onOpen,
}: {
  spec: SimulationSpec;
  tag: number;
  /** The part name from the STEP file, when it has one. */
  name: string | undefined;
  label: string;
  faces: number;
  status: ItemStatus | undefined;
  onChange: (spec: SimulationSpec) => void;
  onOpen: (item: string) => void;
}) {
  const material = spec.bodies.find((b) => b.tag === tag)?.material ?? null;
  const id = `body-material-${tag}`;
  return (
    <section className="setup-panel" aria-label="Body">
      <h2 className="pane-title">{label}</h2>
      <Notes status={status} />
      <dl className="geometry-facts">
        <dt>Name in the file</dt>
        <dd>{name ?? "None given"}</dd>
        <dt>Faces</dt>
        <dd>{faces}, selected in the viewer</dd>
      </dl>
      <div className="field">
        <label htmlFor={id}>Material</label>
        <MaterialSelect spec={spec} tag={tag} label={label} id={id} onChange={onChange} />
        <span className="field-hint">
          {spec.materials.length === 0
            ? "Add a material under Materials, then pick it here."
            : "One material per body. Add more under Materials."}
        </span>
      </div>
      <div className="field-actions">
        {material !== null && (
          <button type="button" onClick={() => onOpen(material)}>
            Open the material
          </button>
        )}
        <button type="button" onClick={() => onOpen("bodies")}>
          All bodies
        </button>
      </div>
    </section>
  );
}
