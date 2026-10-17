# SPDX-License-Identifier: AGPL-3.0-or-later
"""Acceptance case B in FreeCAD FEM: an independent CalculiX model to compare with ClearFEA.

M9.6 compares ClearFEA's result for case B with a model set up by a second tool. This script
builds that model through FreeCAD's FEM API, as a user would in the FEM workbench; FreeCAD's
own CalculiX writer makes the deck.

    cd worker
    uv run python ../verification/acceptance/B-flanged-pipe-thermal/geometry.py B.step
    FreeCAD.AppImage freecadcmd \\
        ../verification/acceptance/B-flanged-pipe-thermal/freecad_model.py \\
        --pass B.step OUT_DIR [size=10] [properties=constant|tables] [ccx=PATH] [gmsh=PATH]

(With an extracted AppImage, `squashfs-root/AppRun freecadcmd ...` does the same.)
Arguments after ``--pass`` go to this script, as ``name=value`` (FreeCAD refuses options that
start with a dash even there).

The setup follows model.md and spec.json:

- Analysis: FreeCAD's thermomechanical analysis, steady state, coupled (CalculiX's
  *COUPLED TEMPERATURE-DISPLACEMENT, STEADY STATE). For a steady state the temperatures do not
  depend on the displacements, so this is the same problem as ClearFEA's heat transfer step
  followed by a static step on its temperatures (ADR-067).
- Initial temperature 20 °C, the stress-free temperature: FreeCAD writes *EXPANSION without a
  reference, so the thermal strain is α (T − T_initial).
- Frictionless supports as displacement constraints holding only the normal component: z on
  the mid-length plane, x on the x = 0 cut, y on the y = 0 cut.
- Convection 2000 W/(m²·K) to 280 °C on the bore, 500 W/(m²·K) to 30 °C on the pipe's outside,
  the flange's back, rim and end face.
- Mesh: FreeCAD's Gmsh mesher, second-order tetrahedra, the global size as the maximum element
  size with no size from curvature.
- Solver: CalculiX, SPOOLES, one thread (as for case A).

FreeCAD 1.0's materials hold one value per property: it has no temperature tables. So:

- ``properties=constant`` (default): the model exactly as FreeCAD writes it, with the constant
  values ``CONSTANT`` below. ClearFEA solves the same constant-property setup for the
  like-for-like comparison (hand_checks.md, check 5).
- ``properties=tables``: the same deck with FreeCAD's three one-line material blocks
  (*ELASTIC, *CONDUCTIVITY, *EXPANSION) replaced by the case's tables, in kelvin, and the
  expansion measured from 20 °C (``ZERO=293.15``), so it can also be compared with case B
  itself. Nothing else in the deck changes.

Output in OUT_DIR: FreeCAD's deck (``Mesh.inp``), CalculiX's ``Mesh.frd``, ``Mesh.dat`` and log,
the Gmsh files, the FreeCAD document and ``summary.json``. Units in FreeCAD's deck: mm, N, MPa,
K, and t/mm/s for heat (W/(m·K) for conductivity).
"""

import argparse
import json
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
from femmesh.gmshtools import GmshTools
from femtools import ccxtools

#: Geometric tolerance for picking faces, in mm.
TOL = 0.01
KELVIN = 273.15

#: Constant properties of the like-for-like run: E at the mean wall temperature (189 GPa, from
#: through_wall.py, rounded), the expansion coefficient and conductivity near the wall's mean.
CONSTANT = {"E_GPa": 189.0, "nu": 0.3, "alpha_per_K": 12.4e-6, "k_W_mK": 46.3}
#: The case's tables (spec.json): (°C, value) rows, each linear between its two rows.
TABLES = {
    "E_MPa": [(20.0, 200e3), (300.0, 182e3)],
    "alpha_per_K": [(20.0, 11.5e-6), (300.0, 12.9e-6)],
    "k_W_mK": [(20.0, 50.0), (300.0, 44.0)],
}

#: Faces by bounding box (case.yaml), in mm.
FACES = {
    "mid-plane": ((0, 0, 0), (150, 150, 0)),
    "cut-x": ((0, 100, 0), (0, 230, 400)),
    "cut-y": ((100, 0, 0), (230, 0, 400)),
    "bore": ((0, 0, 0), (100, 100, 400)),
    "pipe-outside": ((0, 0, 0), (150, 150, 340)),
    "flange-back": ((0, 0, 340), (230, 230, 340)),
    "flange-rim": ((0, 0, 340), (230, 230, 400)),
    "flange-face": ((0, 0, 400), (230, 230, 400)),
}


def parse_args() -> argparse.Namespace:
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
    here = Path(sys.argv[0]).resolve().parent
    parser = argparse.ArgumentParser(prog="freecad_model.py")
    parser.add_argument("step", type=Path, help="STEP file written by geometry.py")
    parser.add_argument("out", type=Path, help="output directory")
    parser.add_argument("--size", type=float, default=10.0, help="global size in mm (10)")
    parser.add_argument("--properties", choices=("constant", "tables"), default="constant")
    parser.add_argument("--ccx", default=str(here / "ccx"), help="ccx (the AppImage's)")
    parser.add_argument("--gmsh", default=str(here / "gmsh"), help="gmsh (the AppImage's)")
    return parser.parse_args(argv)


def in_box(face, lo, hi) -> bool:
    b = face.BoundBox
    return (
        b.XMin >= lo[0] - TOL
        and b.YMin >= lo[1] - TOL
        and b.ZMin >= lo[2] - TOL
        and b.XMax <= hi[0] + TOL
        and b.YMax <= hi[1] + TOL
        and b.ZMax <= hi[2] + TOL
    )


def pick_faces(shape) -> dict[str, list[str]]:
    """The faces of each boundary condition by box; each box must find exactly one face that
    no smaller box already took (the flange rim's box also holds its back and end face)."""
    picked: dict[str, list[str]] = {}
    taken: set[str] = set()
    # Planar faces first, so the rim's and the outside's boxes keep only the curved face.
    order = [
        "mid-plane",
        "cut-x",
        "cut-y",
        "flange-back",
        "flange-face",
        "bore",
        "pipe-outside",
        "flange-rim",
    ]
    for key in order:
        lo, hi = FACES[key]
        names = [
            f"Face{i + 1}"
            for i, face in enumerate(shape.Faces)
            if in_box(face, lo, hi) and f"Face{i + 1}" not in taken
        ]
        if key in ("bore", "pipe-outside", "flange-rim"):
            names = [n for n in names if isinstance(shape.getElement(n).Surface, Part.Cylinder)]
        if len(names) != 1:
            raise RuntimeError(f"{key}: expected one face, found {names}")
        picked[key] = names
        taken.update(names)
    if len(taken) != len(shape.Faces):
        raise RuntimeError(f"{len(shape.Faces) - len(taken)} faces were not picked")
    return picked


def quantity(value: float, unit: str):
    return FreeCAD.Units.Quantity(f"{value!r} {unit}")


def build(doc, part, picked, args):
    analysis = ObjectsFem.makeAnalysis(doc, "Analysis")

    solver = ObjectsFem.makeSolverCalculiXCcxTools(doc, "CalculiX")
    solver.AnalysisType = "thermomech"
    solver.ThermoMechSteadyState = True
    solver.GeometricalNonlinearity = "linear"
    solver.MatrixSolverType = "spooles"
    solver.SplitInputWriter = False
    analysis.addObject(solver)

    material = ObjectsFem.makeMaterialSolid(doc, "Steel")
    mat = material.Material
    mat["Name"] = "Carbon steel (case values)"
    mat["YoungsModulus"] = f"{CONSTANT['E_GPa'] * 1e3} MPa"
    mat["PoissonRatio"] = str(CONSTANT["nu"])
    mat["ThermalExpansionCoefficient"] = f"{CONSTANT['alpha_per_K']} m/m/K"
    mat["ThermalConductivity"] = f"{CONSTANT['k_W_mK']} W/m/K"
    mat["SpecificHeat"] = "500 J/kg/K"  # not used by a steady state
    mat["Density"] = "7850 kg/m^3"  # not used without gravity
    material.Material = mat
    analysis.addObject(material)

    initial = ObjectsFem.makeConstraintInitialTemperature(doc, "StressFree")
    initial.initialTemperature = quantity(20.0 + KELVIN, "K")
    analysis.addObject(initial)

    for key, axis in (("mid-plane", "z"), ("cut-x", "x"), ("cut-y", "y")):
        support = ObjectsFem.makeConstraintDisplacement(
            doc, f"Frictionless_{key.replace('-', '_')}"
        )
        support.References = [(part, tuple(picked[key]))]
        for a in "xyz":
            setattr(support, f"{a}Free", a != axis)  # held (zero displacement) along the normal
        analysis.addObject(support)

    for name, faces, h, t in (
        ("HotFluid", ["bore"], 2000.0, 280.0),
        ("Cooling", ["pipe-outside", "flange-back", "flange-rim", "flange-face"], 500.0, 30.0),
    ):
        film = ObjectsFem.makeConstraintHeatflux(doc, name)
        film.References = [(part, tuple(n for key in faces for n in picked[key]))]
        film.ConstraintType = "Convection"
        film.FilmCoef = h  # W/(m²·K)
        film.AmbientTemp = t + KELVIN  # K
        analysis.addObject(film)

    mesh = ObjectsFem.makeMeshGmsh(doc, "Mesh")
    mesh.Shape = part
    mesh.ElementOrder = "2nd"
    mesh.ElementDimension = "3D"
    mesh.CharacteristicLengthMax = quantity(args.size, "mm")
    mesh.CharacteristicLengthMin = 0
    mesh.MeshSizeFromCurvature = 0
    mesh.SecondOrderLinear = False
    analysis.addObject(mesh)
    doc.recompute()
    return analysis, solver, mesh


def mesh_with_gmsh(mesh, analysis, folder: Path) -> str:
    folder.mkdir(exist_ok=True)
    tools = GmshTools(mesh, analysis)
    tools.update_mesh_data()
    tools.get_tmp_file_paths(str(folder))
    tools.get_gmsh_command()
    cpu_count = os.cpu_count
    os.cpu_count = lambda: 1  # one Gmsh thread: a repeatable mesh
    try:
        tools.write_gmsh_input_files()
    finally:
        os.cpu_count = cpu_count
    messages = tools.run_gmsh_with_geo()
    tools.read_and_set_new_mesh()
    return messages


def use_tables(inp: Path) -> None:
    """Replaces FreeCAD's one-value material lines with the case's tables (kelvin)."""
    text = inp.read_text()
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    replaced = set()
    nu = CONSTANT["nu"]
    while i < len(lines):
        line = lines[i]
        key = line.strip().upper()
        if key == "*ELASTIC":
            out.append("*ELASTIC")
            out += [f"{e:.13G},{nu:.13G},{t + KELVIN:.13G}" for t, e in TABLES["E_MPa"]]
        elif key == "*CONDUCTIVITY":
            out.append("*CONDUCTIVITY")
            out += [f"{k:.13G},{t + KELVIN:.13G}" for t, k in TABLES["k_W_mK"]]
        elif key == "*EXPANSION":
            out.append(f"*EXPANSION, ZERO={20.0 + KELVIN:.13G}")
            out += [f"{a:.13G},{t + KELVIN:.13G}" for t, a in TABLES["alpha_per_K"]]
        else:
            out.append(line)
            i += 1
            continue
        replaced.add(key)
        i += 2  # the keyword and its one value line
    if replaced != {"*ELASTIC", "*CONDUCTIVITY", "*EXPANSION"}:
        raise RuntimeError(f"expected the three material blocks in {inp}, found {replaced}")
    inp.write_text("\n".join(out))


def run_ccx(ccx: str, inp: Path) -> tuple[float, int]:
    env = dict(os.environ, OMP_NUM_THREADS="1", CCX_NPROC_EQUATION_SOLVER="1")
    start = time.monotonic()
    with open(inp.with_suffix(".log"), "w") as log:
        result = subprocess.run(
            [ccx, "-i", inp.stem], cwd=inp.parent, env=env, stdout=log, stderr=subprocess.STDOUT
        )
    seconds = time.monotonic() - start
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    if result.returncode != 0:
        raise RuntimeError(f"ccx failed ({result.returncode}), see {inp.with_suffix('.log')}")
    return seconds, peak


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

    doc = FreeCAD.newDocument("case_b")
    shape = Part.Shape()
    shape.read(str(args.step.resolve()))
    if len(shape.Solids) != 1:
        raise RuntimeError(f"expected one solid, found {len(shape.Solids)}")
    part = doc.addObject("Part::Feature", "FlangedPipe")
    part.Shape = shape.Solids[0]
    doc.recompute()
    picked = pick_faces(part.Shape)
    print("faces:", json.dumps(picked))
    analysis, solver, mesh = build(doc, part, picked, args)

    start = time.monotonic()
    warnings = mesh_with_gmsh(mesh, analysis, out / "gmsh")
    mesh_seconds = time.monotonic() - start
    femmesh = mesh.FemMesh
    if not femmesh.VolumeCount:
        raise RuntimeError(f"Gmsh made no volume mesh: {warnings}")
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
    if args.properties == "tables":
        use_tables(inp)
    solve_seconds, peak_kb = run_ccx(args.ccx, inp)
    fea.load_results()
    doc.saveAs(str(out / "case_b.FCStd"))
    summary = {
        "freecad": ".".join(FreeCAD.Version()[:3]),
        "size_mm": args.size,
        "properties": args.properties,
        "elements": femmesh.VolumeCount,
        "nodes": femmesh.NodeCount,
        "mesh_seconds": round(mesh_seconds, 1),
        "solve_seconds": round(solve_seconds, 1),
        "ccx_peak_rss_MB": round(peak_kb / 1024),
        "frd": str(inp.with_suffix(".frd")),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ in ("__main__", "freecad_model"):
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)
