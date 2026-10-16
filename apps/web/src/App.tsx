// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type GeometryView,
  type IsotropicMaterial,
  type LocalMeshScope,
  type LocalMeshSize,
  preRunProblems,
  type SessionUser,
  type SimulationSpec,
  systemUnit,
} from "@clearfea/spec";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSession, signOut } from "./api/session";
import { GeometryPanel } from "./geometry/GeometryPanel";
import { TestJobs } from "./jobs/TestJobs";
import { SettingsPanel } from "./layout/SettingsPanel";
import { SimulationTree } from "./layout/SimulationTree";
import { StatusBar } from "./layout/StatusBar";
import { Viewer } from "./layout/Viewer";
import { SignIn } from "./session/SignIn";
import { GroupPanel, LoadPanel, MaterialPanel, SupportPanel } from "./setup/ItemPanels";
import { MaterialChooser } from "./setup/MaterialLibrary";
import { LocalSizePanel, MeshPanel } from "./setup/MeshPanel";
import { type ResultChoice, type ResultUnits, type RunBlocker, RunPanel } from "./setup/RunPanel";
import { useEstimate } from "./setup/useEstimate";
import {
  addLoad,
  addLocalSize,
  addMaterial,
  addSupport,
  facesOf,
  type Group,
  type ItemStatus,
  type LoadType,
  localSizeOf,
  meshIsCurrent,
  meshStatus,
  runStatus,
  type SupportType,
  setupStatus,
} from "./setup/spec";
import { useMaterials } from "./setup/useMaterials";
import { useMesh } from "./setup/useMesh";
import { useRun } from "./setup/useRun";
import { useSimulation } from "./setup/useSimulation";
import { UnitSystemField } from "./units/QuantityInput";
import { UNIT_SYSTEMS, UnitSystemProvider } from "./units/system";
import { useProject } from "./units/useProject";

type SessionState =
  | { kind: "checking" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "signedIn"; user: SessionUser };

const GROUPS: readonly string[] = ["materials", "supports", "loads"] satisfies Group[];

/** The group a material, support or load belongs to, or null when the id names none. */
function groupOf(spec: SimulationSpec, id: string): Group | null {
  if (spec.materials.some((m) => m.id === id)) return "materials";
  if (spec.supports.some((s) => s.id === id)) return "supports";
  if (spec.loads.some((l) => l.id === id)) return "loads";
  return null;
}

/**
 * Sign-in form until a user is signed in, then the layout shell: tree on the left,
 * viewer in the centre, settings on the right, status bar along the bottom.
 */
export function App() {
  const [session, setSession] = useState<SessionState>({ kind: "checking" });
  const [geometry, setGeometry] = useState<GeometryView | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  // Edges picked in the viewer while a local size on edges is open (M2.8).
  const [edgeSelection, setEdgeSelection] = useState<ReadonlySet<number>>(new Set());
  // The tree item whose settings are shown: "geometry", a group, or a spec item's id.
  const [selected, setSelected] = useState("geometry");
  const [geometryRefresh, setGeometryRefresh] = useState(0);
  const [resultChoice, setResultChoice] = useState<ResultChoice>({ quantity: "vonMises", deformation: "auto" });

  // Face tags belong to one geometry, so a different geometry starts with no selection.
  const geometryId = geometry?.id;
  useEffect(() => {
    void geometryId;
    setSelection(new Set());
    setEdgeSelection(new Set());
    setSelected("geometry");
  }, [geometryId]);

  useEffect(() => {
    let current = true;
    fetchSession().then((result) => {
      if (!current) return;
      if (result.kind === "ok") setSession({ kind: "signedIn", user: result.value });
      else if (result.kind === "signedOut") setSession({ kind: "signedOut" });
      else setSession({ kind: "signedOut", notice: result.problem });
    });
    return () => {
      current = false;
    };
  }, []);

  const signedOut = useCallback((notice?: string) => {
    setSession({ kind: "signedOut", notice });
    setGeometry(null);
  }, []);

  const simulation = useSimulation(geometry, signedOut);
  const { setup, edit } = simulation;
  const spec = setup.kind === "open" ? setup.spec : null;
  const meshes = useMesh(setup.kind === "open" ? setup.id : null, signedOut);
  const { mesh } = meshes;
  const runs = useRun(setup.kind === "open" ? setup.id : null, signedOut);
  const estimate = useEstimate(
    setup.kind === "open" ? setup.id : null,
    setup.kind === "open" && mesh?.status === "ready" && meshIsCurrent(setup.spec, mesh) ? mesh.id : null,
    signedOut,
  );
  const { run } = runs;
  const project = useProject(session.kind === "signedIn", signedOut);
  const materials = useMaterials(setup.kind === "open", signedOut);
  const { unitSystem } = project;
  // One object per unit system, so the viewer does not redraw the results on every render.
  const resultUnits = useMemo<ResultUnits>(
    () => ({
      length: systemUnit(unitSystem, "length"),
      pressure: systemUnit(unitSystem, "pressure"),
      force: systemUnit(unitSystem, "force"),
      moment: systemUnit(unitSystem, "moment"),
      strain: systemUnit(unitSystem, "strain"),
      ratio: systemUnit(unitSystem, "ratio"),
    }),
    [unitSystem],
  );
  const statuses = useMemo(() => {
    if (setup.kind !== "open") return new Map<string, ItemStatus>();
    const result = setupStatus(setup.spec, setup.topology);
    const settings = result.get("mesh");
    if (settings) result.set("mesh", meshStatus(settings, setup.spec, mesh));
    result.set("run", runStatus(run));
    return result;
  }, [setup, mesh, run]);

  /**
   * What stops the setup from being run now, in plain language (M1.12, ADR-034): the pre-run
   * problems of the saved spec, which the API checks too, then the save and the mesh.
   */
  function runBlockers(): RunBlocker[] {
    if (setup.kind !== "open") return [{ message: "Start the setup first.", item: null }];
    const blockers: RunBlocker[] = preRunProblems(setup.spec, setup.topology).map((problem) => ({
      message: problem.message,
      item: problem.item === "bodies" ? "materials" : problem.item,
    }));
    if (simulation.save.kind !== "saved") blockers.push({ message: "Wait until all changes are saved.", item: null });
    // Without a mesh size the pre-run list already asks for one.
    if (setup.spec.mesh.size !== null) {
      if (mesh === null || mesh.status === "failed") {
        blockers.push({ message: "There is no mesh. Generate it under Mesh.", item: "mesh" });
      } else if (!meshIsCurrent(setup.spec, mesh)) {
        blockers.push({ message: "The mesh settings changed after the mesh was made. Generate the mesh again.", item: "mesh" });
      } else if (mesh.status === "meshing") {
        blockers.push({ message: "The mesh is still being made. Wait for it to finish.", item: "mesh" });
      }
    }
    return blockers;
  }

  async function leave() {
    await signOut();
    signedOut();
  }

  /** The faces of the bodies a local size on bodies applies to, to show them in the viewer. */
  function bodyFaces(item: LocalMeshSize): number[] {
    if (setup.kind !== "open") return [];
    return setup.topology.bodies.filter((b) => item.tags.includes(b.tag)).flatMap((b) => b.faces);
  }

  /**
   * Opens a tree item; a support, load or local size on faces also shows its faces as the viewer's
   * selection, a local size on edges its edges, and one on bodies the faces of its bodies.
   */
  function select(id: string) {
    setSelected(id);
    if (spec === null) return;
    const local = localSizeOf(spec, id);
    if (local?.scope === "edges") setEdgeSelection(new Set(local.tags));
    else if (local?.scope === "bodies") setSelection(new Set(bodyFaces(local)));
    const faces = facesOf(spec, id);
    if (faces !== null) setSelection(new Set(faces));
  }

  /** Saves an edit; when it removed the open item, its group (or the mesh) opens instead. */
  function change(next: SimulationSpec) {
    if (spec !== null) {
      const group = groupOf(spec, selected);
      if (group !== null && groupOf(next, selected) === null) setSelected(group);
      if (localSizeOf(spec, selected) !== undefined && localSizeOf(next, selected) === undefined) setSelected("mesh");
      const local = localSizeOf(next, selected);
      if (local?.scope === "bodies") setSelection(new Set(bodyFaces(local)));
    }
    edit(next);
  }

  /**
   * Adds a local mesh size (M2.8): on faces it takes the faces selected in the viewer, on edges
   * the selected edges, and on bodies the only body of a single-body geometry.
   */
  function addLocal(scope: LocalMeshScope) {
    if (spec === null) return;
    const sorted = (tags: ReadonlySet<number>) => [...tags].sort((a, b) => a - b);
    const tags =
      scope === "faces"
        ? sorted(selection)
        : scope === "edges"
          ? sorted(edgeSelection)
          : spec.bodies.length === 1
            ? spec.bodies.map((b) => b.tag)
            : [];
    const added = addLocalSize(spec, scope, tags);
    edit(added.spec);
    setSelected(added.id);
    const item = localSizeOf(added.spec, added.id);
    if (item?.scope === "bodies") setSelection(new Set(bodyFaces(item)));
    else if (item?.scope === "edges") setEdgeSelection(new Set(item.tags));
  }

  /** Adds a copy of a library or saved material (M2.9). */
  function addFrom(material: IsotropicMaterial) {
    if (spec === null) return;
    const added = addMaterial(spec, material);
    edit(added.spec);
    setSelected(added.id);
  }

  /** Adds an item to a group; a new support, pressure or force takes the faces selected in the viewer. */
  function add(group: Group, type?: SupportType | LoadType) {
    if (spec === null) return;
    const faces = [...selection].sort((a, b) => a - b);
    const added =
      group === "materials"
        ? addMaterial(spec)
        : group === "supports"
          ? addSupport(spec, (type ?? "fixed") as SupportType, faces)
          : addLoad(spec, (type ?? "pressure") as LoadType, faces);
    edit(added.spec);
    setSelected(added.id);
  }

  async function start() {
    if (await simulation.start()) setGeometryRefresh((n) => n + 1);
  }

  function settings() {
    if (spec === null || selected === "geometry") return null;
    const status = statuses.get(selected);
    if (selected === "mesh") {
      return (
        <MeshPanel
          spec={spec}
          status={status}
          mesh={mesh}
          saved={simulation.save.kind === "saved"}
          requesting={meshes.requesting}
          requestProblem={meshes.requestProblem}
          reused={meshes.reused}
          onChange={change}
          onGenerate={() => void meshes.generate()}
          onAddLocal={addLocal}
        />
      );
    }
    const local = localSizeOf(spec, selected);
    if (local) {
      return (
        <LocalSizePanel
          key={selected}
          spec={spec}
          item={local}
          status={status}
          selection={selection}
          edgeSelection={edgeSelection}
          edgesAvailable={setup.kind === "open" && setup.topology.edges !== undefined}
          onChange={change}
        />
      );
    }
    if (selected === "run") {
      return (
        <RunPanel
          status={status}
          run={run}
          currentSpec={spec}
          log={runs.log}
          blockers={runBlockers()}
          onOpen={select}
          units={resultUnits}
          estimate={estimate}
          requesting={runs.requesting}
          requestProblem={runs.requestProblem}
          onRun={(machineSize) => void runs.start(machineSize)}
          choice={resultChoice}
          onChoiceChange={setResultChoice}
        />
      );
    }
    if (GROUPS.includes(selected)) {
      const group = selected as Group;
      return (
        <GroupPanel group={group} status={status} onAdd={(type) => add(group, type)}>
          {group === "materials" && (
            <MaterialChooser list={materials.list} onAdd={addFrom} onDelete={materials.remove} />
          )}
        </GroupPanel>
      );
    }
    const material = spec.materials.find((m) => m.id === selected);
    if (material) {
      return (
        <MaterialPanel
          key={selected}
          spec={spec}
          material={material}
          status={status}
          onChange={change}
          onSave={materials.save}
        />
      );
    }
    const support = spec.supports.find((s) => s.id === selected);
    if (support) {
      return (
        <SupportPanel
          key={selected}
          spec={spec}
          support={support}
          status={status}
          selection={selection}
          onChange={change}
        />
      );
    }
    const load = spec.loads.find((l) => l.id === selected);
    if (load) {
      return (
        <LoadPanel key={selected} spec={spec} load={load} status={status} selection={selection} onChange={change} />
      );
    }
    return null;
  }

  if (session.kind !== "signedIn") {
    return (
      <div className="signin-page">
        {session.kind === "signedOut" && (
          <SignIn
            notice={session.notice}
            onSignedIn={(user) => setSession({ kind: "signedIn", user })}
          />
        )}
        <StatusBar />
      </div>
    );
  }

  const itemPanel = settings();
  // An item that is gone (for example after the setup was reloaded) shows the geometry instead.
  const showGeometry = itemPanel === null;

  return (
    <UnitSystemProvider value={unitSystem}>
    <div className="shell">
      <SimulationTree
        units={
          <UnitSystemField
            value={unitSystem}
            systems={UNIT_SYSTEMS}
            onChange={(next) => void project.changeUnitSystem(next)}
            disabled={project.saving}
            problem={project.problem}
          />
        }
        geometry={geometry}
        setup={setup}
        statuses={statuses}
        save={simulation.save}
        selected={showGeometry ? "geometry" : selected}
        onSelect={select}
        onStart={start}
        starting={simulation.starting}
        startProblem={simulation.startProblem}
      />
      <Viewer
        geometry={geometry}
        mesh={!showGeometry && selected === "mesh" ? mesh : null}
        result={
          !showGeometry && selected === "run" && run?.status === "succeeded"
            ? { run, ...resultChoice, units: resultUnits }
            : null
        }
        selection={selection}
        onSelectionChange={setSelection}
        pickEdges={!showGeometry && spec !== null && localSizeOf(spec, selected)?.scope === "edges"}
        edgeSelection={edgeSelection}
        onEdgeSelectionChange={setEdgeSelection}
        simulationId={setup.kind === "open" ? setup.id : null}
        onResultChange={setResultChoice}
        onSignedOut={signedOut}
      />
      <SettingsPanel>
        {/* Kept mounted while hidden: it loads the geometry and follows its import. */}
        <div hidden={!showGeometry}>
          <GeometryPanel onSignedOut={signedOut} onGeometryChange={setGeometry} refresh={geometryRefresh} />
          {showGeometry && <TestJobs onSignedOut={signedOut} />}
        </div>
        {itemPanel}
      </SettingsPanel>
      <StatusBar user={session.user} onSignOut={leave} />
    </div>
    </UnitSystemProvider>
  );
}
