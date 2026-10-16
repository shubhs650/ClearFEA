// SPDX-License-Identifier: AGPL-3.0-or-later
// The bonds of the setup (M4.2, ADR-059): faces of different bodies that the import found
// touching, each tied unless the user removes it. The user reviews every bond (accept or
// remove), and showing a bond selects its two faces in the viewer.

import { type BondStatus, bondKey, type SimulationSpec, specBonds, type Topology } from "@clearfea/spec";
import { fromSi } from "../units/convert";
import { useSystemUnit } from "../units/system";
import { Notes } from "./ItemPanels";
import { type ItemStatus, setBondStatus } from "./spec";

const statusLabels: Record<BondStatus, string> = {
  detected: "Detected, tied",
  accepted: "Accepted, tied",
  removed: "Removed, not tied",
};

/** A number for a table: four significant digits, no exponent for everyday sizes. */
function shown(value: number): string {
  return String(Number(value.toPrecision(4)));
}

export function BondsPanel({
  spec,
  topology,
  labels,
  status,
  selection,
  onChange,
  onShow,
}: {
  spec: SimulationSpec;
  topology: Topology;
  labels: ReadonlyMap<number, string>;
  status: ItemStatus | undefined;
  /** The faces selected in the viewer: the bond whose two faces they are is marked as shown. */
  selection: ReadonlySet<number>;
  onChange: (spec: SimulationSpec) => void;
  /** Selects faces in the viewer. */
  onShow: (faces: readonly number[]) => void;
}) {
  const lengthUnit = useSystemUnit("length");
  const areaUnit = useSystemUnit("area");
  const bonds = specBonds(spec, topology);
  const candidates = new Map((topology.bonds ?? []).map((b) => [bondKey(b.faces), b]));
  const label = (body: number | undefined) => (body === undefined ? "?" : (labels.get(body) ?? `Body ${body}`));
  const detected = bonds.filter((b) => b.status === "detected").map((b) => bondKey(b.faces));
  const tied = bonds.filter((b) => b.status !== "removed").flatMap((b) => b.faces);
  const review = (faces: readonly number[], next: BondStatus) => onChange(setBondStatus(spec, topology, [bondKey(faces)], next));

  let intro: string;
  if (topology.bonds === undefined) {
    intro =
      "This geometry was imported before bonds were detected. Upload the STEP file again to find the faces where its bodies touch.";
  } else if (topology.bodies.length < 2) {
    intro = "The geometry has one body, so there is nothing to bond.";
  } else if (bonds.length === 0) {
    intro =
      "No faces of different bodies touch, so no bonds were found. Bodies that should be joined must touch in the CAD model.";
  } else {
    const tolerance = topology.bondTolerance;
    const within =
      tolerance === undefined ? "" : ` within ${shown(fromSi(tolerance, lengthUnit, "length"))} ${lengthUnit}`;
    intro = `Faces of different bodies that touch${within} are bonded: the solver ties them together. Accept each bond, or remove it where the parts should not be joined. Show a bond to select its faces in the viewer.`;
  }

  return (
    <section className="setup-panel" aria-label="Bonds">
      <h2 className="pane-title">Bonds</h2>
      <Notes status={status} />
      <p className="field-hint">{intro}</p>
      {bonds.length > 0 && (
        <ul className="bond-list" aria-label="Bonds found">
          {bonds.map((bond) => {
            const key = bondKey(bond.faces);
            const candidate = candidates.get(key);
            const name = `${label(candidate?.bodies[0])} to ${label(candidate?.bodies[1])}`;
            const isShown = selection.size === 2 && bond.faces.every((f) => selection.has(f));
            const area = candidate === undefined ? null : `${shown(fromSi(candidate.area, areaUnit, "area"))} ${areaUnit}`;
            return (
              <li
                key={key}
                className={bond.status === "removed" ? "bond bond-removed" : "bond"}
                aria-label={name}
                aria-current={isShown ? "true" : undefined}
              >
                <button
                  type="button"
                  className="link-button"
                  aria-label={`Show the bond ${name}, faces ${bond.faces.join(" and ")}`}
                  onClick={() => onShow(bond.faces)}
                >
                  {name}
                </button>
                <span className="field-hint bond-facts">
                  Faces {bond.faces.join(" and ")}
                  {area !== null && `, ${area}`}. {statusLabels[bond.status]}.
                </span>
                <span className="bond-actions">
                  {bond.status === "detected" && (
                    <button type="button" aria-label={`Accept the bond ${name}`} onClick={() => review(bond.faces, "accepted")}>
                      Accept
                    </button>
                  )}
                  {bond.status !== "removed" ? (
                    <button type="button" aria-label={`Remove the bond ${name}`} onClick={() => review(bond.faces, "removed")}>
                      Remove
                    </button>
                  ) : (
                    <button type="button" aria-label={`Restore the bond ${name}`} onClick={() => review(bond.faces, "accepted")}>
                      Restore
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {bonds.length > 0 && (
        <div className="field-actions">
          {detected.length > 1 && (
            <button type="button" onClick={() => onChange(setBondStatus(spec, topology, detected, "accepted"))}>
              Accept all {detected.length} detected bonds
            </button>
          )}
          <button type="button" onClick={() => onShow(tied)} disabled={tied.length === 0}>
            Show every tied bond
          </button>
        </div>
      )}
    </section>
  );
}
