# SPDX-License-Identifier: AGPL-3.0-or-later
"""Acceptance case A in FreeCAD FEM: an independent CalculiX model to compare with ClearFEA.

M9.5 compares ClearFEA's result for case A with a model set up by a second tool. This script
builds that model through FreeCAD's FEM API, as a user would in the FEM workbench, without
writing any solver input by hand: FreeCAD's own CalculiX writer makes the deck.

    cd worker
    uv run python ../verification/acceptance/A-nozzle-on-shell/geometry.py A.step
    FreeCAD.AppImage freecadcmd \\
        ../verification/acceptance/A-nozzle-on-shell/freecad_model.py \\
        --pass A.step OUT_DIR [size=12] [local_size=6] [ccx=PATH] [gmsh=PATH]

(With an extracted AppImage, `squashfs-root/AppRun freecadcmd ...` does the same.)
Arguments after ``--pass`` go to this script; FreeCAD would otherwise open them as documents.
FreeCAD refuses options that start with a dash even there, so options are ``name=value``.

The setup follows model.md and spec.json:

- Geometry: the STEP file of geometry.py (mm). The three solids are joined with a
  BooleanFragments in CompSolid mode, so the faces where they touch become shared faces and
  Gmsh meshes them with shared nodes: the bonds are fully conformal here, where ClearFEA ties
  separately meshed bodies (ADR-060).
- Material: E = 200 GPa, nu = 0.3 on all three bodies.
- Fixed: the shell's end at x = -600.
- Pressure 2 MPa: the shell's inside, the nozzle's bore and the nozzle's foot faces (the faces
  on the r = 300 bore cylinder).
- Force: +565.487 kN in x on the shell's end at x = +600, +35.343 kN in z on the nozzle's end.
- Piping load F = (4, -3, -6) kN, M = (2, 3, 1.5) kN m at (0, 0, 560) on the nozzle's end.
  FreeCAD has no distributing remote load (ClearFEA's, ADR-041), so it is a ConstraintRigidBody
  with its reference node at that point and all six components in "Load" mode: CalculiX's
  *RIGID BODY, which makes the nozzle's end face rigid. Away from the end face the two give
  the same result (Saint-Venant); the end face itself is stiffer here.
- Mesh: FreeCAD's Gmsh mesher, second-order tetrahedra (C3D10), the global size as the
  maximum element size with no size from curvature (as ClearFEA's mesher), and an optional
  local size on the nozzle's and pad's faces (a FreeCAD mesh region).
- Solver: CalculiX static, linear, SPOOLES. CalculiX is run by this script, not by FreeCAD's
  runner, so it gets one thread: FreeCAD 1.0's ccxtools sets OMP_NUM_THREADS to the number of
  CPUs, and multithreaded SPOOLES has given wrong answers here.

One change is made to FreeCAD's deck before the run, an output request only: the fixed
support's reaction is printed per node (TOTALS=YES) instead of only as a total, so that its
moment about the held face's centroid can be summed (``reactions_per_node``).

Output in OUT_DIR: FreeCAD's deck (``Mesh.inp``), CalculiX's ``Mesh.frd``, ``Mesh.dat`` and
log, the Gmsh files (``gmsh/``), the FreeCAD document ``case_a.FCStd`` and ``summary.json``
with the mesh size, run time, CalculiX's peak memory, the reaction at the held end with its
moment about the face's centroid, the reaction statics expects, the loads the rigid body's
nodes carry, the held face's section print and the von Mises check of case.yaml.
Units in FreeCAD's deck: mm, N, MPa, N mm.
"""

import argparse
import json
import math
import os
import resource
import subprocess
import sys
import time
import traceback
from pathlib import Path

import FreeCAD
import ObjectsFem
import Part
from BOPTools import SplitFeatures
from femmesh.gmshtools import GmshTools
from femtools import ccxtools

#: Geometric tolerance for picking faces, in mm.
TOL = 0.01
#: Shell inside radius, its ends and the nozzle's inside radius and end, in mm (geometry.py).
SHELL_RI, X_HELD, X_FREE, NOZZLE_RI, NOZZLE_TOP = 300.0, -600.0, 600.0, 75.0, 560.0

#: Loads in N, moments in N mm, pressure in MPa (spec.json converted at this one place).
PRESSURE_MPA = 2.0
SHELL_THRUST_N = 565.487e3
NOZZLE_THRUST_N = 35.343e3
PIPING_POINT_MM = (0.0, 0.0, 560.0)
PIPING_FORCE_N = (4.0e3, -3.0e3, -6.0e3)
PIPING_MOMENT_NMM = (2.0e6, 3.0e6, 1.5e6)
#: The held face's centroid, about which the reaction moment is reported, in mm.
HELD_CENTROID_MM = (X_HELD, 0.0, 0.0)


def parse_args() -> argparse.Namespace:
    """The arguments after ``--pass``; ``name=value`` is read as ``--name value``."""
    argv = sys.argv[sys.argv.index("--pass") + 1 :] if "--pass" in sys.argv else []
    argv = [
        word
        for arg in argv
        for word in (
            ["--" + arg.split("=", 1)[0].replace("_", "-"), arg.split("=", 1)[1]]
            if "=" in arg
            else [arg]
        )
    ]
    # The AppImage's freecadcmd, ccx and gmsh sit in one bin directory.
    here = Path(sys.argv[0]).resolve().parent
    parser = argparse.ArgumentParser(prog="freecad_model.py")
    parser.add_argument("step", type=Path, help="STEP file written by geometry.py")
    parser.add_argument("out", type=Path, help="output directory")
    parser.add_argument("--size", type=float, default=12.0, help="global size in mm (12)")
    parser.add_argument(
        "--local-size", type=float, default=0.0, help="size on nozzle and pad faces, mm (off)"
    )
    parser.add_argument(
        "--piping",
        choices=("rigid", "none"),
        default="rigid",
        help="the piping load on a rigid end face, or none (pressure and thrusts only)",
    )
    parser.add_argument("--ccx", default=str(here / "ccx"), help="ccx (the AppImage's)")
    parser.add_argument("--gmsh", default=str(here / "gmsh"), help="gmsh (the AppImage's)")
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------------------------
# Geometry


def import_bodies(doc, step: Path) -> dict[str, object]:
    """The three solids of the STEP file as Part features, named by their shape."""
    shape = Part.Shape()
    shape.read(str(step))
    if len(shape.Solids) != 3:
        raise RuntimeError(f"expected three solids in {step}, found {len(shape.Solids)}")
    bodies = {}
    for solid in shape.Solids:
        box = solid.BoundBox
        if box.XLength > 1000:  # runs the shell's whole length
            name = "Shell"
        elif box.ZMax > NOZZLE_TOP - TOL:  # reaches the nozzle's end
            name = "Nozzle"
        else:
            name = "Pad"
        feature = doc.addObject("Part::Feature", name)
        feature.Shape = solid
        bodies[name] = feature
    if sorted(bodies) != ["Nozzle", "Pad", "Shell"]:
        raise RuntimeError(f"could not tell the three bodies apart: {sorted(bodies)}")
    return bodies


def fragments(doc, bodies: dict[str, object]):
    """One CompSolid of the three bodies: touching faces become one shared face."""
    frag = SplitFeatures.makeBooleanFragments(name="Fragments")
    frag.Objects = [bodies["Shell"], bodies["Nozzle"], bodies["Pad"]]
    frag.Mode = "CompSolid"
    doc.recompute()
    shape = frag.Shape
    if len(shape.Solids) != 3:
        raise RuntimeError(f"fragments made {len(shape.Solids)} solids, expected 3")
    return frag


def boundary_faces(shape) -> list[tuple[str, object]]:
    """(name, face) of every face that bounds exactly one solid, so not a bonded face."""
    owners = {i: 0 for i in range(len(shape.Faces))}
    for solid in shape.Solids:
        for face in solid.Faces:
            for i, candidate in enumerate(shape.Faces):
                if candidate.isSame(face):
                    owners[i] += 1
    return [(f"Face{i + 1}", shape.Faces[i]) for i, n in owners.items() if n == 1]


def in_box(face, lo: tuple[float, float, float], hi: tuple[float, float, float]) -> bool:
    """Whether the face's bounding box lies inside [lo, hi], as case.yaml picks faces."""
    b = face.BoundBox
    return (
        b.XMin >= lo[0] - TOL
        and b.YMin >= lo[1] - TOL
        and b.ZMin >= lo[2] - TOL
        and b.XMax <= hi[0] + TOL
        and b.YMax <= hi[1] + TOL
        and b.ZMax <= hi[2] + TOL
    )


def on_cylinder(face, radius: float, axis: tuple[float, float, float]) -> bool:
    """Whether the face is part of a cylinder of this radius whose axis runs along ``axis``
    through the origin."""
    surface = face.Surface
    if not isinstance(surface, Part.Cylinder) or abs(surface.Radius - radius) > TOL:
        return False
    direction = surface.Axis
    parallel = abs(abs(direction.dot(FreeCAD.Vector(*axis))) - 1) < 1e-9
    centre = surface.Center
    off_axis = centre - FreeCAD.Vector(*axis) * centre.dot(FreeCAD.Vector(*axis))
    return parallel and off_axis.Length < TOL


def pick_faces(shape) -> dict[str, list[str]]:
    """The faces of each boundary condition, by geometry (no face numbers)."""
    faces = boundary_faces(shape)

    def select(test) -> list[str]:
        return [name for name, face in faces if test(face)]

    picked = {
        "held-end": select(lambda f: in_box(f, (X_HELD, -310, -310), (X_HELD, 310, 310))),
        "free-end": select(lambda f: in_box(f, (X_FREE, -310, -310), (X_FREE, 310, 310))),
        # Shell inside and the nozzle's foot faces: everything on the r = 300 bore cylinder.
        "shell-inside-and-feet": select(lambda f: on_cylinder(f, SHELL_RI, (1, 0, 0))),
        "nozzle-bore": select(lambda f: on_cylinder(f, NOZZLE_RI, (0, 0, 1))),
        "nozzle-end": select(lambda f: in_box(f, (-83, -83, NOZZLE_TOP), (83, 83, NOZZLE_TOP))),
    }
    for key, names in picked.items():
        if not names:
            raise RuntimeError(f"no face found for {key}")
    return picked


# ---------------------------------------------------------------------------------------------
# Analysis


def quantity(value: float, unit: str):
    """A FreeCAD quantity of ``value`` in ``unit``. Quantity(value, Unit(...)) would read the
    value in FreeCAD's internal mm-kg-s units instead (1 N internal is 1e-3 N)."""
    return FreeCAD.Units.Quantity(f"{value!r} {unit}")


def face_normal(shape, name: str) -> FreeCAD.Vector:
    face = shape.getElement(name)
    u0, u1, v0, v1 = face.ParameterRange
    return face.normalAt((u0 + u1) / 2, (v0 + v1) / 2)


def force_on(doc, analysis, frag, name, faces, newtons, axis: FreeCAD.Vector):
    """A ConstraintForce of ``newtons`` along ``axis``, its direction taken from the first
    (planar) face's normal and reversed where that normal points the other way."""
    force = ObjectsFem.makeConstraintForce(doc, name)
    force.References = [(frag, tuple(faces))]
    force.Force = quantity(newtons, "N")
    force.Direction = (frag, [faces[0]])
    normal = face_normal(frag.Shape, faces[0])
    if abs(abs(normal.dot(axis)) - 1) > 1e-9:
        raise RuntimeError(f"{name}: face {faces[0]} is not normal to {axis}")
    force.Reversed = normal.dot(axis) < 0
    analysis.addObject(force)
    return force


def add_piping_load(doc, analysis, frag, picked) -> None:
    """The piping load as a rigid body constraint on the nozzle's end face."""
    piping = ObjectsFem.makeConstraintRigidBody(doc, "PipingLoad")
    piping.References = [(frag, tuple(picked["nozzle-end"]))]
    piping.ReferenceNode = FreeCAD.Vector(*PIPING_POINT_MM)
    for axis, f, m in zip("XYZ", PIPING_FORCE_N, PIPING_MOMENT_NMM, strict=True):
        setattr(piping, f"TranslationalMode{axis}", "Load")
        setattr(piping, f"RotationalMode{axis}", "Load")
        setattr(piping, f"Force{axis}", quantity(f, "N"))
        setattr(piping, f"Moment{axis}", quantity(m, "N*mm"))
    analysis.addObject(piping)


def build(doc, frag, picked, args) -> tuple[object, object, object]:
    analysis = ObjectsFem.makeAnalysis(doc, "Analysis")

    solver = ObjectsFem.makeSolverCalculiXCcxTools(doc, "CalculiX")
    solver.AnalysisType = "static"
    solver.GeometricalNonlinearity = "linear"
    solver.MatrixSolverType = "spooles"
    solver.SplitInputWriter = False
    analysis.addObject(solver)

    # One material, no references: it applies to every solid.
    material = ObjectsFem.makeMaterialSolid(doc, "Steel")
    mat = material.Material
    mat["Name"] = "Carbon steel (case values)"
    mat["YoungsModulus"] = "200000 MPa"
    mat["PoissonRatio"] = "0.3"
    mat["Density"] = "7850 kg/m^3"  # not used by a static run without gravity
    material.Material = mat
    analysis.addObject(material)

    fixed = ObjectsFem.makeConstraintFixed(doc, "HeldEnd")
    fixed.References = [(frag, tuple(picked["held-end"]))]
    analysis.addObject(fixed)

    pressure = ObjectsFem.makeConstraintPressure(doc, "InternalPressure")
    pressure_faces = picked["shell-inside-and-feet"] + picked["nozzle-bore"]
    pressure.References = [(frag, tuple(pressure_faces))]
    pressure.Pressure = quantity(PRESSURE_MPA, "MPa")
    pressure.Reversed = False  # pushes into the material, as an internal pressure does
    analysis.addObject(pressure)

    x_axis, z_axis = FreeCAD.Vector(1, 0, 0), FreeCAD.Vector(0, 0, 1)
    force_on(doc, analysis, frag, "ShellThrust", picked["free-end"], SHELL_THRUST_N, x_axis)
    force_on(doc, analysis, frag, "NozzleThrust", picked["nozzle-end"], NOZZLE_THRUST_N, z_axis)

    if args.piping == "rigid":
        add_piping_load(doc, analysis, frag, picked)

    # Section forces and moments on the held face, about its centroid, from the stresses: a
    # second, cruder reading of the reaction (one element through the wall at 12 mm).
    section = ObjectsFem.makeConstraintSectionPrint(doc, "HeldEndSection")
    section.References = [(frag, tuple(picked["held-end"]))]
    analysis.addObject(section)

    mesh = ObjectsFem.makeMeshGmsh(doc, "Mesh")
    mesh.Shape = frag
    mesh.ElementOrder = "2nd"
    mesh.ElementDimension = "3D"
    mesh.CharacteristicLengthMax = quantity(args.size, "mm")
    mesh.CharacteristicLengthMin = 0
    mesh.MeshSizeFromCurvature = 0
    mesh.SecondOrderLinear = False  # mid-side nodes on the curved faces
    analysis.addObject(mesh)
    if args.local_size > 0:
        region = ObjectsFem.makeMeshRegion(doc, mesh, args.local_size, "NozzleAndPad")
        region.References = [(frag, tuple(local_faces(frag.Shape)))]
    doc.recompute()
    return analysis, solver, mesh


def local_faces(shape) -> list[str]:
    """Every face of the nozzle and the pad: the solids of the fragments that are not the
    shell (the one that runs the shell's whole length)."""
    names = []
    for solid in shape.Solids:
        if solid.BoundBox.XLength > 1000:
            continue
        for face in solid.Faces:
            for i, candidate in enumerate(shape.Faces):
                name = f"Face{i + 1}"
                if candidate.isSame(face) and name not in names:
                    names.append(name)
    return names


# ---------------------------------------------------------------------------------------------
# Run and read back


def mesh_with_gmsh(mesh, analysis, folder: Path) -> str:
    """Meshes with FreeCAD's Gmsh tools, as GmshTools.create_mesh does, but keeps the .geo,
    .brep and .unv files in ``folder``; returns Gmsh's warnings and errors."""
    folder.mkdir(exist_ok=True)
    tools = GmshTools(mesh, analysis)
    tools.update_mesh_data()
    tools.get_tmp_file_paths(str(folder))
    tools.get_gmsh_command()
    # FreeCAD writes General.NumThreads = os.cpu_count() into the .geo, and a multithreaded
    # Gmsh run need not give the same mesh twice; one thread makes the mesh repeatable.
    cpu_count = os.cpu_count
    os.cpu_count = lambda: 1
    try:
        tools.write_gmsh_input_files()
    finally:
        os.cpu_count = cpu_count
    messages = tools.run_gmsh_with_geo()
    tools.read_and_set_new_mesh()
    return messages


def run_ccx(ccx: str, inp: Path) -> tuple[float, int]:
    """Runs CalculiX on the deck single-threaded; returns wall time in s and peak RSS in kB."""
    env = dict(os.environ, OMP_NUM_THREADS="1", CCX_NPROC_EQUATION_SOLVER="1")
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    start = time.monotonic()
    with open(inp.with_suffix(".log"), "w") as log:
        result = subprocess.run(
            [ccx, "-i", inp.stem], cwd=inp.parent, env=env, stdout=log, stderr=subprocess.STDOUT
        )
    seconds = time.monotonic() - start
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    if result.returncode != 0:
        raise RuntimeError(f"ccx failed ({result.returncode}), see {inp.with_suffix('.log')}")
    # ru_maxrss of children is the largest single child; Gmsh ran before CalculiX.
    return seconds, after if after > before else -1


def reactions_per_node(inp: Path) -> None:
    """Asks for the held end's reaction at every node as well as the total.

    FreeCAD prints only the total (TOTALS=ONLY), which has no moment. TOTALS=YES prints each
    node's RF and the total; an output request only, the model is FreeCAD's as written."""
    text = inp.read_text()
    request = "*NODE PRINT, NSET=HeldEnd, TOTALS=ONLY\n"
    if text.count(request) != 1:
        raise RuntimeError(f"expected one {request.strip()!r} in {inp}")
    inp.write_text(text.replace(request, "*NODE PRINT, NSET=HeldEnd, TOTALS=YES\n"))


def read_dat(dat: Path, femmesh) -> dict[str, list[float]]:
    """From the .dat: the held end's reaction (the nodes' RF, summed here with their moment
    about the held face's centroid, and CalculiX's total), the forces the rigid body's two
    nodes carry (the loads that reached them), and the held face's section print."""
    blocks: dict[str, list[list[float]]] = {}
    title = None
    for line in dat.read_text().splitlines():
        words = line.split()
        if not words:
            continue
        try:
            values = [float(w) for w in words]
        except ValueError:
            title = line.strip()
            continue
        if title is not None:
            blocks.setdefault(title, []).append(values)

    def block(start: str) -> list[list[float]]:
        for key, rows in blocks.items():
            if key.startswith(start):
                return rows
        return []

    found: dict[str, list[float]] = {}
    nodes = block("forces (fx,fy,fz) for set HELDEND")
    if nodes:
        force, moment = [0.0] * 3, [0.0] * 3
        for n, *rf in nodes:
            p = femmesh.getNodeById(int(n))
            r = [p.x - HELD_CENTROID_MM[0], p.y - HELD_CENTROID_MM[1], p.z - HELD_CENTROID_MM[2]]
            force = [a + b for a, b in zip(force, rf, strict=True)]
            moment = [a + b for a, b in zip(moment, cross(r, rf), strict=True)]
        found["reaction_N"] = force
        found["reaction_moment_Nmm"] = moment
    for key, start in (
        ("ccx_total_reaction_N", "total force (fx,fy,fz) for set HELDEND"),
        ("rigid_body_ref_node_N", "total force (fx,fy,fz) for set PIPINGLOAD_REFNODE"),
        ("rigid_body_rot_node_Nmm", "total force (fx,fy,fz) for set PIPINGLOAD_ROTNODE"),
        ("section_centre_mm", "center of gravity and mean normal"),
        ("section_moment_Nmm", "moment about the center of gravity"),
    ):
        rows = block(start)
        if rows:
            found[key] = rows[0][:3]
    rows = block("total surface force (fx,fy,fz)")
    if rows:
        found["section_force_N"] = rows[0][:3]
    return found


def von_mises_check(analysis, femmesh) -> dict[str, float]:
    """Von Mises at the shell's outside nodes in case.yaml's check box (x 440 to 460 mm,
    under the shell), against Lame's closed-end 51.109 MPa."""
    results = [o for o in analysis.Group if o.isDerivedFrom("Fem::FemResultObject")]
    if not results:
        return {}
    result = results[0]
    values = []
    for n, vm in zip(result.NodeNumbers, result.vonMises, strict=True):
        p = femmesh.getNodeById(n)
        radius = math.hypot(p.y, p.z)
        if 440 <= p.x <= 460 and abs(p.y) <= 100 and p.z < -290 and abs(radius - 310) < 0.01:
            values.append(vm)
    if not values:
        return {}
    return {
        "nodes": len(values),
        "mean_MPa": sum(values) / len(values),
        "min_MPa": min(values),
        "max_MPa": max(values),
        "max_von_mises_anywhere_MPa": max(result.vonMises),
    }


def cross(a, b) -> list[float]:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def expected_reaction(piping: bool) -> tuple[list[float], list[float]]:
    """The reaction force (N) and its moment about the held face's centroid (N mm) that
    balance the applied loads, from statics.

    The pressure on the walls alone is the negative of the pressure that would act on the
    three missing caps (a closed surface under uniform pressure carries no net force or
    moment): the two shell-end caps cancel, the nozzle cap (area pi 75^2 at z = 560) leaves
    -p pi 75^2 in z through (0, 0, 560), which the nozzle's thrust cancels. So the walls'
    pressure plus the thrusts reduce to the shell's thrust along the axis, which has no moment
    about the held centroid, plus the nozzle thrust's equal and opposite pair."""
    p_cap = PRESSURE_MPA * math.pi * NOZZLE_RI**2
    nozzle_point = [PIPING_POINT_MM[i] - HELD_CENTROID_MM[i] for i in range(3)]
    loads = [  # (force N, point mm relative to the held centroid)
        ([SHELL_THRUST_N, 0, 0], [X_FREE - X_HELD, 0, 0]),
        ([0, 0, NOZZLE_THRUST_N], nozzle_point),
        ([0, 0, -p_cap], nozzle_point),  # walls' net pressure, see above
    ]
    if piping:
        loads.append((list(PIPING_FORCE_N), nozzle_point))
    force = [sum(f[i] for f, _ in loads) for i in range(3)]
    moment = list(PIPING_MOMENT_NMM) if piping else [0.0, 0.0, 0.0]
    for f, r in loads:
        moment = [a + b for a, b in zip(moment, cross(r, f), strict=True)]
    return [-v for v in force], [-v for v in moment]


def main() -> None:
    args = parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    gmsh_prefs = FreeCAD.ParamGet("User parameter:BaseApp/Preferences/Mod/Fem/Gmsh")
    gmsh_prefs.SetBool("UseStandardGmshLocation", False)
    gmsh_prefs.SetString("gmshBinaryPath", args.gmsh)
    FreeCAD.ParamGet("User parameter:BaseApp/Preferences/Mod/Fem/General").SetString(
        "WorkingDir", str(out)
    )

    doc = FreeCAD.newDocument("case_a")
    bodies = import_bodies(doc, args.step.resolve())
    frag = fragments(doc, bodies)
    picked = pick_faces(frag.Shape)
    print("faces:", json.dumps(picked))
    analysis, solver, mesh = build(doc, frag, picked, args)

    start = time.monotonic()
    warnings = mesh_with_gmsh(mesh, analysis, out / "gmsh")
    mesh_seconds = time.monotonic() - start
    femmesh = mesh.FemMesh
    if not femmesh.VolumeCount:
        raise RuntimeError(f"Gmsh made no volume mesh: {warnings}")
    if warnings:
        print("Gmsh warnings:\n" + warnings)
    print(f"mesh: {femmesh.VolumeCount} elements, {femmesh.NodeCount} nodes")

    fea = ccxtools.FemToolsCcx(analysis, solver)
    fea.update_objects()
    fea.setup_working_dir(str(out))
    fea.setup_ccx(ccx_binary=args.ccx)
    message = fea.check_prerequisites()
    if message:
        raise RuntimeError(f"FreeCAD prerequisites: {message}")
    fea.write_inp_file()
    inp = Path(fea.inp_file_name)
    reactions_per_node(inp)
    solve_seconds, peak_kb = run_ccx(args.ccx, inp)
    fea.load_results()
    doc.saveAs(str(out / "case_a.FCStd"))

    found = read_dat(inp.with_suffix(".dat"), femmesh)
    force, moment = expected_reaction(args.piping != "none")
    summary = {
        "freecad": ".".join(FreeCAD.Version()[:3]),
        "size_mm": args.size,
        "local_size_mm": args.local_size or None,
        "piping": args.piping,
        "elements": femmesh.VolumeCount,
        "nodes": femmesh.NodeCount,
        "mesh_seconds": round(mesh_seconds, 1),
        "solve_seconds": round(solve_seconds, 1),
        "ccx_peak_rss_MB": round(peak_kb / 1024) if peak_kb > 0 else None,
        "frd": str(inp.with_suffix(".frd")),
        "expected_reaction_N": force,
        "expected_moment_Nmm": moment,
        **found,
        "von_mises_at_x450": von_mises_check(analysis, femmesh),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


# FreeCADCmd imports a script as a module named after its file, and when that import raises
# it runs the file a second time as __main__; leave at the first failure with a status.
if __name__ in ("__main__", "freecad_model"):
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
