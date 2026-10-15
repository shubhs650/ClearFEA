# SPDX-License-Identifier: AGPL-3.0-or-later
"""M1.8 solve check: run the solve job's steps on a meshed bar and compare the result reader's
figures with closed-form answers.

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the result reader alone decides: which numbers of the .frd and .dat files become
displacement, stress and reaction, their components and signs, the von Mises formula, and
where the extremes are reported. It stands in until V-01, V-02 and `make verify` (M1.13).

    cd worker && uv run python spikes/solve_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import math
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deck_check"))

from check import E_SI, P_SI, H, L, box_faces, spec, write_bar  # noqa: E402

from clearfea_worker.deck import generate_deck  # noqa: E402
from clearfea_worker.deck.elements import FACE_NODES  # noqa: E402
from clearfea_worker.geometry.importer import import_geometry  # noqa: E402
from clearfea_worker.meshing.mesher import mesh_geometry  # noqa: E402
from clearfea_worker.meshing.volume import read_volume_mesh  # noqa: E402
from clearfea_worker.results import read_results  # noqa: E402
from clearfea_worker.results.fields import von_mises_field  # noqa: E402
from clearfea_worker.solver import run_calculix  # noqa: E402
from clearfea_worker.spec.geometry_schema import Topology  # noqa: E402
from clearfea_worker.versions import calculix_version  # noqa: E402

Row = tuple[str, str, str, bool]


def solve(spec_, mesh, work: Path):  # type: ignore[no-untyped-def]
    """The solve job's steps without transfers: deck, CalculiX, result reader."""
    work.mkdir(parents=True)
    deck = work / "job.inp"
    deck.write_text(generate_deck(spec_, mesh))
    run = run_calculix(deck, lambda line: None, threading.Event())
    if run.returncode != 0 or run.errors():
        raise RuntimeError(f"CalculiX failed in {work}: {run.errors()}")
    version = calculix_version() or "unknown"
    return read_results(spec_, mesh, work / "job.frd", work / "job.dat", version)


def rel(a: float, b: float) -> float:
    return abs(a - b) / abs(b)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    root = args.out or Path(tempfile.mkdtemp(prefix="solve-check-"))
    root.mkdir(parents=True, exist_ok=True)

    step = write_bar(root / "bar.step")
    import_geometry(step, root / "import", None)
    topology = Topology.model_validate_json((root / "import" / "topology.json").read_bytes())
    faces = box_faces(topology)
    out = mesh_geometry(step, topology, root / "mesh", scaling=1.0, size=0.005, unit="mm", order=2)
    mesh = read_volume_mesh(out.mesh_path)
    length, side = L / 1000, H / 1000
    area = side * side
    rows: list[Row] = []

    # 1. Compression, Poisson's ratio 0: uniform stress -p, so von Mises is p at every node,
    #    the free end moves -p L / E along x, and the support pulls back with +p A along x.
    fields, result = solve(spec(faces["x-"][0], faces["x+"][0], 10.0, 0.0), mesh, root / "nu0")
    sxx = [fields.stress[6 * n] for n in range(mesh.node_count)]
    others = max(abs(fields.stress[6 * n + i]) for n in range(mesh.node_count) for i in range(1, 6))
    rows.append(
        (
            "nu = 0: sigma_xx at every node",
            f"{-P_SI:.6g} Pa",
            f"{min(sxx):.6g} to {max(sxx):.6g} Pa",
            max(rel(s, -P_SI) for s in sxx) < 1e-4,
        )
    )
    rows.append(
        (
            "nu = 0: other stress components",
            "0 Pa",
            f"largest {others:.3g} Pa",
            others < 1e-4 * P_SI,
        )
    )
    vm = result.von_mises
    rows.append(
        (
            "nu = 0: von Mises min and max",
            f"{P_SI:.6g} Pa",
            f"{vm.min.value:.6g} to {vm.max.value:.6g} Pa",
            rel(vm.min.value, P_SI) < 1e-4 and rel(vm.max.value, P_SI) < 1e-4,
        )
    )
    tip = P_SI * length / E_SI
    d = result.displacement.max
    ux = fields.displacement[3 * d.node]
    rows.append(
        (
            "nu = 0: largest displacement, x of its node",
            f"{tip:.6g} m at x = {length:g} m, u_x < 0",
            f"{d.value:.6g} m at x = {d.position[0]:.6g} m, u_x {ux:.6g} m",
            rel(d.value, tip) < 1e-4 and math.isclose(d.position[0], length) and ux < 0,
        )
    )
    reaction = result.reactions[0].force
    rows.append(
        (
            "nu = 0: reaction of the fixed end",
            f"{P_SI * area:.6g}, 0, 0 N",
            ", ".join(f"{r:.6g}" for r in reaction) + " N",
            math.dist(reaction, [P_SI * area, 0, 0]) < 1e-6 * P_SI * area,
        )
    )

    # 2. Compression, Poisson's ratio 0.3: the clamped end restrains the lateral expansion
    #    locally, but at mid-length (Saint-Venant) the stress is uniform -p again.
    fields, result = solve(spec(faces["x-"][0], faces["x+"][0], 10.0, 0.3), mesh, root / "nu03")
    mises = von_mises_field(fields)
    middle = [
        n for n in range(mesh.node_count) if 0.4 * length <= mesh.positions[3 * n] <= 0.6 * length
    ]
    worst_sxx = max(rel(fields.stress[6 * n], -P_SI) for n in middle)
    worst_vm = max(rel(mises[n], P_SI) for n in middle)
    rows.append(
        (
            f"nu = 0.3: sigma_xx and von Mises at mid-length ({len(middle)} nodes)",
            f"{-P_SI:.6g} Pa and {P_SI:.6g} Pa within 0.5 %",
            f"worst {100 * worst_sxx:.3f} % and {100 * worst_vm:.3f} %",
            worst_sxx < 5e-3 and worst_vm < 5e-3,
        )
    )
    rows.append(
        (
            "nu = 0.3: largest von Mises at the clamped end",
            "x = 0",
            f"x = {result.von_mises.max.position[0]:.6g} m",
            math.isclose(result.von_mises.max.position[0], 0.0, abs_tol=1e-12),
        )
    )

    # 3. Cantilever under pressure on its top face (y+), x- fixed: the free end deflects
    #    towards -y. Timoshenko beam with a uniform line load q = p b: tip deflection
    #    q L^4 / (8 E I) + q L^2 / (2 k G A), k = 5/6. The clamp and the coarse mesh make the
    #    solid model differ by a few percent, so this checks direction and size, not accuracy.
    nu = 0.3
    fields, result = solve(spec(faces["x-"][0], faces["y+"][0], 10.0, nu), mesh, root / "beam")
    q, inertia = P_SI * side, side**4 / 12
    shear = E_SI / (2 * (1 + nu))
    beam = q * length**4 / (8 * E_SI * inertia) + q * length**2 / (2 * (5 / 6) * shear * area)
    end = [n for n in range(mesh.node_count) if math.isclose(mesh.positions[3 * n], length)]
    uy = sum(fields.displacement[3 * n + 1] for n in end) / len(end)
    rows.append(
        (
            "cantilever: mean u_y of the free end",
            f"{-beam:.6g} m within 3 %",
            f"{uy:.6g} m ({100 * (uy / -beam - 1):+.2f} %)",
            uy < 0 and rel(-uy, beam) < 0.03,
        )
    )
    # CalculiX's reaction total leaves out the load that lands on nodes the support holds
    # (ADR-029, M1.7 handoff): here the mid-edge nodes of the top face's triangles on the
    # clamped edge. On a flat 6-node triangle a uniform pressure puts nothing on the corners
    # and a third of p A on each mid-edge node, so the free part of the load is known exactly.
    reaction = result.reactions[0].force
    load = P_SI * length * side
    held = 0.0
    for element, local in mesh.faces[faces["y+"][0]]:
        nodes = [mesh.elements[10 * element + k] for k in FACE_NODES[2][local]]
        a, b, c = (mesh.positions[3 * n : 3 * n + 3] for n in nodes[:3])
        ab = [b[i] - a[i] for i in range(3)]
        ac = [c[i] - a[i] for i in range(3)]
        cross = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ]
        triangle = 0.5 * math.sqrt(sum(v * v for v in cross))
        held += sum(P_SI * triangle / 3 for n in nodes[3:] if mesh.positions[3 * n] == 0.0)
    free = load - held
    rows.append(
        (
            "cantilever: reaction of the clamped end",
            f"0, {free:.6g}, 0 N ({load:.6g} N less {held:.4g} N on held nodes)",
            ", ".join(f"{r:.6g}" for r in reaction) + " N",
            math.dist(reaction, [0, free, 0]) < 1e-6 * load,
        )
    )
    d = result.displacement.max
    rows.append(
        (
            "cantilever: largest displacement at the free end",
            f"x = {length:g} m",
            f"x = {d.position[0]:.6g} m",
            math.isclose(d.position[0], length),
        )
    )

    print(f"C3D10, {mesh.element_count} elements, {mesh.node_count} nodes\n")
    print("| Case | Expected | ClearFEA | Result |")
    print("| --- | --- | --- | --- |")
    for case, expected, got, ok in rows:
        print(f"| {case} | {expected} | {got} | {'ok' if ok else 'MISMATCH'} |")
    failed = sum(1 for row in rows if not row[3])
    print(f"\n{len(rows) - failed} of {len(rows)} checks within tolerance. Files in {root}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
