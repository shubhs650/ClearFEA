# SPDX-License-Identifier: AGPL-3.0-or-later
"""M1.7 deck check: solve generated decks with CalculiX and compare with closed-form answers.

Script only, not part of the worker package or its tests (the fast tier runs no solver).
It stands in for verification cases until the `make verify` harness lands in M1.13, and
checks what the deck generator alone decides: the CalculiX node order, the face numbers a
pressure is written to, the pressure's sign, and the unit conversion of entered values.

    cd worker && uv run python spikes/deck_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from clearfea_worker.deck import generate_deck
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import mesh_geometry
from clearfea_worker.meshing.volume import VolumeMesh, read_volume_mesh
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: The bar, in millimetres as the STEP file declares it: x from 0 to L, square section.
L, H = 200.0, 20.0
#: Entered values, in deliberately mixed units.
PRESSURE = (10.0, "bar")  # 1e6 Pa
MODULUS = (210_000.0, "MPa")  # 2.1e11 Pa
SIZE = (5.0, "mm")

P_SI, E_SI = 1.0e6, 2.1e11
AXES = "xyz"


def write_bar(path: Path) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, L, H, H)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def box_faces(topology: Topology) -> dict[str, tuple[int, list[float], float]]:
    """Faces of the bar by name (x-, x+, y-, ...): tag, outward normal, area in m^2."""
    lo, hi = [0.0, 0.0, 0.0], [L / 1000, H / 1000, H / 1000]
    named = {}
    for face in topology.faces:
        for axis in range(3):
            for side, bound, sign in (("-", lo, -1.0), ("+", hi, 1.0)):
                if math.isclose(face.centroid[axis], bound[axis], abs_tol=1e-9):
                    normal = [0.0, 0.0, 0.0]
                    normal[axis] = sign
                    named[f"{AXES[axis]}{side}"] = (face.tag, normal, face.area)
    assert len(named) == 6, named
    return named


def spec(fixed: int, loaded: int, pressure: float, poisson: float) -> SimulationSpec:
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "linear_static",
            "geometryId": "deck-check",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [
                {
                    "id": "steel",
                    "name": "Steel",
                    "model": "isotropic_elastic",
                    "youngsModulus": {"value": MODULUS[0], "unit": MODULUS[1]},
                    "poissonsRatio": poisson,
                }
            ],
            "supports": [{"id": "fixed-1", "type": "fixed", "name": "Fixed", "faces": [fixed]}],
            "loads": [
                {
                    "id": "pressure-1",
                    "type": "pressure",
                    "name": "Pressure",
                    "faces": [loaded],
                    "magnitude": {"value": pressure, "unit": PRESSURE[1]},
                }
            ],
            "mesh": {"size": {"value": SIZE[0], "unit": SIZE[1]}},
        }
    )


def solve(deck: str, work: Path, name: str) -> tuple[list[float], dict[int, list[float]]]:
    """Runs CalculiX; returns the support's total reaction and the nodal displacements."""
    (work / f"{name}.inp").write_text(deck)
    run = subprocess.run(["ccx", "-i", name], cwd=work, capture_output=True, text=True)
    if run.returncode != 0 or "*ERROR" in run.stdout:
        raise RuntimeError(f"CalculiX failed on {name}:\n{run.stdout[-2000:]}")
    lines = (work / f"{name}.dat").read_text().splitlines()
    total = next(i for i, line in enumerate(lines) if "total force" in line)
    reaction = [float(v) for v in lines[total + 2].split()]
    displacements: dict[int, list[float]] = {}
    in_disp = False
    for line in (work / f"{name}.frd").read_text().splitlines():
        if line.startswith(" -4  DISP"):
            in_disp = True
        elif in_disp and line.startswith(" -3"):
            break
        elif in_disp and line.startswith(" -1"):
            node = int(line[3:13])
            displacements[node] = [float(line[13 + 12 * k : 25 + 12 * k]) for k in range(3)]
    return reaction, displacements


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    root = args.out or Path(tempfile.mkdtemp(prefix="deck-check-"))
    root.mkdir(parents=True, exist_ok=True)

    step = write_bar(root / "bar.step")
    import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    faces = box_faces(topology)
    opposite = {f"{a}-": f"{a}+" for a in AXES} | {f"{a}+": f"{a}-" for a in AXES}

    rows: list[tuple[str, str, str, str, bool]] = []
    for order in (1, 2):
        out = mesh_geometry(
            step, topology, root / f"mesh-p{order}", scaling=1.0, size=0.005, unit="mm", order=order
        )
        mesh: VolumeMesh = read_volume_mesh(out.mesh_path)
        label = f"C3D{4 if order == 1 else 10}"
        # The bar's faces must use every local face of a tetrahedron, or a face number
        # would go unchecked.
        used = {local for pairs in mesh.faces.values() for _, local in pairs}
        rows.append(
            (
                label,
                "local faces on the bar's faces",
                "0, 1, 2, 3",
                str(sorted(used))[1:-1],
                used == {0, 1, 2, 3},
            )
        )

        # 1. Every face loaded in turn, the opposite face fixed. The pressure pushes the face
        #    towards the body, so the body is pushed along -n and the support pulls back along
        #    +n: the reaction total is +p A n, n the loaded face's outward normal.
        for name, (tag, normal, area) in sorted(faces.items()):
            for value in (PRESSURE[0], -PRESSURE[0]):
                deck = generate_deck(spec(faces[opposite[name]][0], tag, value, 0.3), mesh)
                case = f"p{order}-{name}-{'push' if value > 0 else 'pull'}"
                reaction, _ = solve(deck, root, case)
                p = math.copysign(P_SI, value)
                expected = [p * area * n for n in normal]
                error = math.dist(reaction, expected) / (P_SI * area)
                rows.append(
                    (
                        label,
                        f"{'+' if value > 0 else '-'}{PRESSURE[0]:g} {PRESSURE[1]} on {name}, "
                        f"{opposite[name]} fixed",
                        "reaction " + ", ".join(f"{e:.6g}" for e in expected) + " N",
                        "reaction " + ", ".join(f"{r:.6g}" for r in reaction) + " N",
                        error < 1e-6,
                    )
                )

        # 2. Bar in compression with Poisson's ratio 0: the clamped end restrains nothing, so
        #    the exact answer is uniform stress -p and the free end moves by -p L / E.
        deck = generate_deck(spec(faces["x-"][0], faces["x+"][0], PRESSURE[0], 0.0), mesh)
        _, displacements = solve(deck, root, f"p{order}-stiffness")
        tip = [
            displacements[n + 1][0]
            for n in range(mesh.node_count)
            if math.isclose(mesh.positions[3 * n], L / 1000, abs_tol=1e-9)
        ]
        expected_tip = -P_SI * (L / 1000) / E_SI
        worst = max(abs(u - expected_tip) for u in tip) / abs(expected_tip)
        rows.append(
            (
                label,
                f"+{PRESSURE[0]:g} {PRESSURE[1]} on x+, x- fixed, Poisson's ratio 0",
                f"x+ face u_x {expected_tip:.6g} m",
                f"u_x {min(tip):.6g} to {max(tip):.6g} m ({len(tip)} nodes)",
                worst < 1e-4,
            )
        )

    print("| Elements | Case | Expected | CalculiX | Result |")
    print("| --- | --- | --- | --- | --- |")
    for label, case, expected, got, ok in rows:
        print(f"| {label} | {case} | {expected} | {got} | {'ok' if ok else 'MISMATCH'} |")
    failed = sum(1 for row in rows if not row[4])
    print(f"\n{len(rows) - failed} of {len(rows)} checks within tolerance. Files in {root}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
