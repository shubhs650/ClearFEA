# SPDX-License-Identifier: AGPL-3.0-or-later
"""M1.8 solve check: run the solve job's steps on a meshed bar and compare the result reader's
figures with closed-form answers. M1.9 adds checks of the viewer's result files.

Script only, not part of the worker package or its tests (the fast tier runs no solver). It
checks what the result reader alone decides: which numbers of the .frd and .dat files become
displacement, stress and reaction, their components and signs, the von Mises formula, and
where the extremes are reported. It is kept beside `make verify`, run by hand (ADR-035).

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
from clearfea_worker.geometry.display import read_display  # noqa: E402
from clearfea_worker.geometry.importer import import_geometry  # noqa: E402
from clearfea_worker.meshing.mesher import mesh_geometry  # noqa: E402
from clearfea_worker.meshing.volume import read_volume_mesh  # noqa: E402
from clearfea_worker.results import read_results  # noqa: E402
from clearfea_worker.results.fields import principal_field, von_mises_field  # noqa: E402
from clearfea_worker.results.surface import (  # noqa: E402
    extract_surface,
    read_fields,
    write_viewer_files,
)
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


def viewer_rows(mesh, fields, result, faces, work: Path) -> list[Row]:  # type: ignore[no-untyped-def]
    """M1.9: the viewer's surface.bin and fields.bin, read back as the viewer would."""
    files = write_viewer_files(mesh, fields, work)
    patches = read_display(files.surface_path)
    _, written = read_fields(files.fields_path)
    by_name = {f.name: f for f in written}
    displacement, mises = by_name["displacement"], by_name["vonMises"]
    rows: list[Row] = []
    total, wrong = 0.0, 0
    tag_normal = {tag: normal for tag, normal, _ in faces.values()}
    for patch in patches:
        p = patch.positions
        for k in range(len(patch.triangles) // 3):
            a, b, c = (p[3 * v : 3 * v + 3] for v in patch.triangles[3 * k : 3 * k + 3])
            u = [b[i] - a[i] for i in range(3)]
            w = [c[i] - a[i] for i in range(3)]
            n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
            total += 0.5 * math.sqrt(sum(x * x for x in n))
            if sum(n[i] * tag_normal[patch.tag][i] for i in range(3)) <= 0:
                wrong += 1
    length, side = L / 1000, H / 1000
    surface_area = 4 * length * side + 2 * side * side
    rows.append(
        (
            "viewer: surface area, triangles facing outwards",
            f"{surface_area:.6g} m^2, all outwards",
            f"{total:.6g} m^2, {wrong} facing inwards",
            rel(total, surface_area) < 1e-5 and wrong == 0,
        )
    )
    v = displacement.values
    largest = max(
        math.sqrt(v[3 * k] ** 2 + v[3 * k + 1] ** 2 + v[3 * k + 2] ** 2) for k in range(len(v) // 3)
    )
    d = result.displacement.max.value
    rows.append(
        (
            "viewer: largest surface displacement",
            f"{d:.6g} m (the summary's, float32)",
            f"{largest:.6g} m",
            rel(largest, d) < 1e-6,
        )
    )
    vm = result.von_mises
    lo, hi = min(mises.values), max(mises.values)
    rows.append(
        (
            "viewer: surface von Mises range",
            f"{vm.min.value:.6g} to {vm.max.value:.6g} Pa or inside it, max equal",
            f"{lo:.6g} to {hi:.6g} Pa",
            lo >= vm.min.value * (1 - 1e-6) and rel(hi, vm.max.value) < 1e-6,
        )
    )
    # M3.1: the stress, principal stress and strain fields carry the reader's nodal values.
    surface = extract_surface(mesh)
    principal = principal_field(fields)
    worst = 0.0
    for name, nodal, width in (
        ("stress", fields.stress, 6),
        ("principalStress", principal, 3),
        ("strain", fields.strain, 6),
    ):
        values = by_name[name].values
        scale = max(abs(x) for x in nodal)
        for k, node in enumerate(surface.nodes):
            for i in range(width):
                worst = max(worst, abs(values[width * k + i] - nodal[width * node + i]) / scale)
    rows.append(
        (
            "viewer: stress, principal stress and strain fields",
            "the nodal values, to float32",
            f"worst {worst:.2g} of the largest",
            worst < 1e-6,
        )
    )
    return rows


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
    exx = [fields.strain[6 * n] for n in range(mesh.node_count)]
    strain_others = max(
        abs(fields.strain[6 * n + i]) for n in range(mesh.node_count) for i in range(1, 6)
    )
    rows.append(
        (
            "nu = 0: total strain eps_xx at every node, others zero",
            f"{-P_SI / E_SI:.6g}, others 0",
            f"{min(exx):.6g} to {max(exx):.6g}, others at most {strain_others:.3g}",
            max(rel(e, -P_SI / E_SI) for e in exx) < 1e-4 and strain_others < 1e-4 * P_SI / E_SI,
        )
    )
    principal = principal_field(fields)
    s1 = max(abs(principal[3 * n + i]) for n in range(mesh.node_count) for i in (0, 1))
    s3 = [principal[3 * n + 2] for n in range(mesh.node_count)]
    rows.append(
        (
            "nu = 0: principal stresses",
            f"sigma_3 = {-P_SI:.6g} Pa, sigma_1 = sigma_2 = 0",
            f"sigma_3 {min(s3):.6g} to {max(s3):.6g} Pa, sigma_1 and sigma_2 at most {s1:.3g} Pa",
            max(rel(x, -P_SI) for x in s3) < 1e-4 and s1 < 1e-4 * P_SI,
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
    # Every load at a held node is taken out of CalculiX's RF (M3.2, ADR-051; before, a third
    # of p A on each mid-edge node of the top face's triangles on the clamped edge was left
    # out), so the clamp carries the whole load W = p L b, with the moment W L / 2 about the
    # clamped face's centre (0, b/2, b/2), and the run's balance closes.
    reaction = result.reactions[0]
    load = P_SI * length * side
    rows.append(
        (
            "cantilever: reaction of the clamped end",
            f"0, {load:.6g}, 0 N",
            ", ".join(f"{r:.6g}" for r in reaction.force) + " N",
            math.dist(reaction.force, [0, load, 0]) < 1e-6 * load,
        )
    )
    expected_moment = [0.0, 0.0, load * length / 2]
    assert reaction.moment is not None and reaction.point is not None
    rows.append(
        (
            "cantilever: reaction moment about the clamped face's centre",
            f"0, 0, {expected_moment[2]:.6g} N m about 0, {side / 2:g}, {side / 2:g} m",
            ", ".join(f"{r:.6g}" for r in reaction.moment)
            + " N m about "
            + ", ".join(f"{r:.6g}" for r in reaction.point)
            + " m",
            math.dist(reaction.moment, expected_moment) < 1e-6 * load * length
            and math.dist(reaction.point, [0, side / 2, side / 2]) < 1e-12,
        )
    )
    balance = result.balance
    assert balance is not None
    rows.append(
        (
            "cantilever: the run's balance check",
            "force and moment within 1e-6",
            f"force {balance.force_ratio:.2g}, moment {balance.moment_ratio:.2g}",
            max(balance.force_ratio, balance.moment_ratio) < 1e-6,
        )
    )
    viewer_dir = root / "beam-viewer"
    viewer_dir.mkdir()
    rows.extend(viewer_rows(mesh, fields, result, faces, viewer_dir))
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
