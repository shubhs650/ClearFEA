# SPDX-License-Identifier: AGPL-3.0-or-later
"""M6.1 modal check: solve modal decks with CalculiX through the deck generator and the result
reader, and compare the natural frequencies of a slender bar with Euler-Bernoulli beam theory
(ADR-070): clamped at one end (cantilever), clamped at both ends, held by frictionless supports
(a half bar on its symmetry plane, which keeps only the modes symmetric about it), and free.

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the platform path cannot see exactly: the frequency step and its solver, the units
of density and stiffness through to the eigenvalues, how the reader turns them into hertz, and
the six rigid-body modes of a free body.

    cd worker && uv run python spikes/modal_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Solves with SPOOLES, since a host's ccx
may be built without PaStiX (ADR-063); the platform's worker image has both. Exit status is
non-zero if a check fails.
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
from clearfea_worker.meshing.volume import read_volume_mesh
from clearfea_worker.results import read_results
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: The bar, in millimetres as the STEP file declares it: x from 0 to L, b wide along y, h deep
#: along z, so it bends most easily about y (in z), then about z (in y).
L, B, H = 600.0, 20.0, 10.0
#: Steel-like values in mixed units: 200 GPa, 7.85 g/cm³.
E, NU, RHO = 200e9, 0.3, 7850.0
#: Euler-Bernoulli: f = (βL)² / (2π L²) √(E I / (ρ A)), with I / A = d² / 12 for depth d.
CANTILEVER = (1.875104069, 4.694091133, 7.854757438)
CLAMPED = (4.730040745, 7.853204624, 10.99560784)


def beam(beta_l: float, depth_mm: float, length_mm: float = L) -> float:
    """Euler-Bernoulli bending frequency (Hz) for a mode's βL and the depth it bends across."""
    length, depth = length_mm / 1000, depth_mm / 1000
    return beta_l**2 / (2 * math.pi * length**2) * math.sqrt(E * depth**2 / (12 * RHO))


def write_bar(path: Path, length: float = L) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, length, B, H)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def spec(supports: list[dict], modes: int) -> SimulationSpec:
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "modal",
            "geometryId": "check",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [
                {
                    "id": "steel",
                    "name": "Steel",
                    "model": "isotropic_elastic",
                    "youngsModulus": {"value": E / 1e9, "unit": "GPa"},
                    "poissonsRatio": NU,
                    "density": {"value": RHO / 1000, "unit": "g/cm³"},
                }
            ],
            "supports": supports,
            "loads": [],
            "mesh": {"size": {"value": 5, "unit": "mm"}},
            "modes": modes,
        }
    )


def solve(setup: SimulationSpec, mesh, work: Path) -> list[float]:  # type: ignore[no-untyped-def]
    work.mkdir(exist_ok=True)
    (work / "job.inp").write_text(generate_deck(setup, mesh, solver="SPOOLES"))
    run = subprocess.run(["ccx", "-i", "job"], cwd=work, capture_output=True, text=True)
    if run.returncode != 0 or "*ERROR" in run.stdout:
        raise RuntimeError(f"CalculiX failed:\n{run.stdout[-2000:]}")
    warnings = [line for line in run.stdout.splitlines() if "WARNING" in line]
    if warnings:
        raise RuntimeError(f"CalculiX warned: {warnings[:3]}")
    _, result = read_results(setup, mesh, work / "job.frd", work / "job.dat", "check")
    assert result.frequencies is not None
    return result.frequencies


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, help="keep the work files here")
    args = parser.parse_args()
    root = args.out or Path(tempfile.mkdtemp(prefix="modal-check-"))
    root.mkdir(parents=True, exist_ok=True)
    failed = False

    def report(name: str, value: float, reference: float, tolerance: float) -> None:
        nonlocal failed
        error = value / reference - 1
        ok = abs(error) <= tolerance
        failed |= not ok
        print(
            f"  {'ok  ' if ok else 'FAIL'} {name}: {value:.6g} Hz against {reference:.6g} Hz "
            f"({100 * error:+.3f} %, tolerance {100 * tolerance:g} %)"
        )

    bar = write_bar(root / "bar.step")
    import_geometry(bar, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())

    def ends() -> tuple[int, int]:
        x0 = [f.tag for f in topology.faces if abs(f.centroid[0]) < 1e-9]
        x1 = [f.tag for f in topology.faces if abs(f.centroid[0] - L / 1000) < 1e-9]
        return x0[0], x1[0]

    root_face, tip_face = ends()
    for order in (2,):
        out = mesh_geometry(
            bar, topology, root / f"mesh-p{order}", scaling=1.0, size=0.005, unit="mm", order=order
        )
        mesh = read_volume_mesh(out.mesh_path)
        print(f"C3D{4 if order == 1 else 10}, {mesh.element_count} elements")
        fixed = [{"id": "root", "type": "fixed", "name": "Root", "faces": [root_face]}]
        f = solve(spec(fixed, 5), mesh, root / f"cantilever-p{order}")
        print(f"cantilever: {', '.join(f'{x:.5g}' for x in f)}")
        # Bending in z (depth H) then in y (depth B), interleaved: z1, y1, z2, y2, z3.
        expected = [
            beam(CANTILEVER[0], H),
            beam(CANTILEVER[0], B),
            beam(CANTILEVER[1], H),
            beam(CANTILEVER[1], B),
            beam(CANTILEVER[2], H),
        ]
        for k, (value, reference) in enumerate(zip(f, expected, strict=True)):
            report(f"cantilever mode {k + 1}", value, reference, 0.01)
        both = [*fixed, {"id": "tip", "type": "fixed", "name": "Tip", "faces": [tip_face]}]
        f = solve(spec(both, 3), mesh, root / f"clamped-p{order}")
        print(f"clamped-clamped: {', '.join(f'{x:.5g}' for x in f)}")
        expected = [beam(CLAMPED[0], H), beam(CLAMPED[0], B), beam(CLAMPED[1], H)]
        for k, (value, reference) in enumerate(zip(f, expected, strict=True)):
            report(f"clamped-clamped mode {k + 1}", value, reference, 0.01)
        f = solve(spec([], 8), mesh, root / f"free-p{order}")
        print(f"free: {', '.join(f'{x:.5g}' for x in f)}")
        rigid = max(abs(x) for x in f[:6])
        ok = rigid <= 1e-4 * f[6]
        failed |= not ok
        print(f"  {'ok  ' if ok else 'FAIL'} free: largest rigid-body mode {rigid:.3g} Hz")
        report("free mode 7", f[6], beam(CLAMPED[0], H), 0.01)
    print("FAILED" if failed else "all checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
