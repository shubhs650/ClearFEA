# SPDX-License-Identifier: AGPL-3.0-or-later
"""M2.3-M2.7 load check: solve parts under a force on a face, gravity, a centrifugal load, a
remote force and moment, hydrostatic pressure and a uniform temperature change with CalculiX
and compare with closed-form answers and with equilibrium (ADR-040 to ADR-042, ADR-044).

Script only, like spikes/support_check (the fast tier runs no solver). It checks what the
deck generator and result reader alone decide for the new loads: a force reaches the nodes
as a uniform traction that sums to the entered force, gravity and centrifugal loads act with
the right size and direction, and the reactions have the applied loads at held nodes taken
back out, so they balance the loads exactly.

    cd worker && uv run python spikes/load_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import math
import sys
import tempfile
import threading
from pathlib import Path

from clearfea_worker.deck import REACTION_SET, DeckError, generate_deck
from clearfea_worker.deck.applied import force_loads
from clearfea_worker.deck.loads import body_load, body_nodal_forces, densities
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import mesh_geometry
from clearfea_worker.meshing.volume import VolumeMesh, read_volume_mesh
from clearfea_worker.results import read_results
from clearfea_worker.results.dat import read_node_forces
from clearfea_worker.results.fields import von_mises_field
from clearfea_worker.solver import run_calculix
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

E_SI, NU = 2.1e11, 0.3
RHO = 7850.0  # kg/m^3, entered as 7.85 g/cm^3
G = 9.80665  # entered as -1 g along z
#: Bar and column in millimetres: length L along x (bar) or z (column), square section H.
L, H = 200.0, 20.0
A_SI = (H / 1000) ** 2
PULL_KN = 20.0
#: Quarter ring in millimetres: radii A to B, height T from z = 0, spun about z.
A, B, T = 90.0, 100.0, 5.0
RPM = 10000.0
#: Remote load on the column's top: point (mm), force (N) and moment (N·m).
REMOTE_POINT = (30.0, -10.0, L + 50.0)
REMOTE_FORCE = (1000.0, -2000.0, -5000.0)
REMOTE_MOMENT = (40.0, -25.0, 60.0)
#: Water on the column: density (kg/m^3) and the free surface's height on one side (mm).
WATER, LEVEL = 1000.0, 150.0
#: Temperature change: expansion entered as 12 µm/(m·K), change as +90 °F (50 K).
ALPHA, DELTA_T = 12e-6, 50.0

Row = tuple[str, str, str, bool]


def gmsh_step(path: Path, build) -> Path:  # type: ignore[no-untyped-def]
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        build(gmsh.model.occ)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def bar(occ) -> None:  # type: ignore[no-untyped-def]
    occ.addBox(0, 0, 0, L, H, H)


def column(occ) -> None:  # type: ignore[no-untyped-def]
    occ.addBox(0, 0, 0, H, H, L)


def ring(occ) -> None:  # type: ignore[no-untyped-def]
    outer = occ.addCylinder(0, 0, 0, 0, 0, T, B)
    inner = occ.addCylinder(0, 0, 0, 0, 0, T, A)
    (annulus, *_), _ = occ.cut([(3, outer)], [(3, inner)])
    quadrant = occ.addBox(0, 0, 0, 2 * B, 2 * B, T)
    occ.intersect([annulus], [(3, quadrant)])


def prepare(
    root: Path,
    name: str,
    build,
    order: int,
    size: float,  # type: ignore[no-untyped-def]
) -> tuple[VolumeMesh, Topology]:
    folder = root / f"{name}-p{order}"
    step = gmsh_step(folder.with_suffix(".step"), build)
    import_geometry(step, folder / "import", None)
    topology = Topology.model_validate_json((folder / "import" / "topology.json").read_bytes())
    out = mesh_geometry(
        step, topology, folder / "mesh", scaling=1.0, size=size, unit="mm", order=order
    )
    return read_volume_mesh(out.mesh_path), topology


def face(topology: Topology, test) -> int:  # type: ignore[no-untyped-def]
    """The one face whose centroid (in mm) passes ``test``."""
    (tag,) = [f.tag for f in topology.faces if test(*(v * 1000 for v in f.centroid))]
    return tag


def q(value: float, unit: str) -> dict:
    return {"value": value, "unit": unit}


def spec(
    supports: list[dict], loads: list[dict], density: bool = True, expansion: bool = False
) -> SimulationSpec:
    material = {
        "id": "steel",
        "name": "Steel",
        "model": "isotropic_elastic",
        "youngsModulus": q(210, "GPa"),
        "poissonsRatio": NU,
    }
    if density:
        material["density"] = q(RHO / 1000, "g/cm³")
    if expansion:
        material["thermalExpansion"] = q(ALPHA * 1e6, "µm/(m·K)")
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "linear_static",
            "geometryId": "load-check",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [material],
            "supports": supports,
            "loads": loads,
            "mesh": {"size": q(5, "mm")},
        }
    )


def frictionless(id_: str, faces: list[int]) -> dict:
    return {"id": id_, "type": "frictionless", "name": id_, "faces": faces}


def gravity(id_: str = "g", z: float = -1.0) -> dict:
    return {
        "id": id_,
        "type": "gravity",
        "name": id_,
        "x": q(0, "g"),
        "y": q(0, "g"),
        "z": q(z, "g"),
    }


def spin(id_: str = "w", rpm: float = RPM, direction=(0.0, 0.0, 1.0)) -> dict:  # type: ignore[no-untyped-def]
    x, y, z = direction
    return {
        "id": id_,
        "type": "centrifugal",
        "name": id_,
        "angularVelocity": q(rpm, "rpm"),
        "axisPoint": {"x": q(0, "mm"), "y": q(0, "mm"), "z": q(0, "mm")},
        "axisDirection": {"x": x, "y": y, "z": z},
    }


def solve(spec_: SimulationSpec, mesh: VolumeMesh, work: Path):  # type: ignore[no-untyped-def]
    work.mkdir(parents=True)
    deck = work / "job.inp"
    deck.write_text(generate_deck(spec_, mesh))
    run = run_calculix(deck, lambda line: None, threading.Event())
    if run.returncode != 0 or run.errors():
        raise RuntimeError(f"CalculiX failed in {work}: {run.errors()}")
    return read_results(spec_, mesh, work / "job.frd", work / "job.dat", "check")


def applied_total(spec_: SimulationSpec, mesh: VolumeMesh) -> list[float]:
    """Every force and body load the deck applies, added up over the mesh (N)."""
    total = [0.0, 0.0, 0.0]
    loads = list(force_loads(spec_, mesh).values())
    load = body_load(spec_)
    if load is not None:
        loads += body_nodal_forces(mesh, densities(spec_, mesh), load).values()
    for f in loads:
        for i in range(3):
            total[i] += f[i]
    return total


def rel(a: float, b: float) -> float:
    return abs(a - b) / abs(b)


def show(v) -> str:  # type: ignore[no-untyped-def]
    return ", ".join(f"{x:.6g}" for x in v)


def balance_row(label: str, spec_: SimulationSpec, mesh: VolumeMesh, result) -> Row:  # type: ignore[no-untyped-def]
    """The reactions are the applied loads' opposite, to the solver's printed digits."""
    applied = applied_total(spec_, mesh)
    total = [sum(r.force[i] for r in result.reactions) for i in range(3)]
    size = math.sqrt(sum(a * a for a in applied))
    miss = math.dist(total, [-a for a in applied])
    return (
        f"{label}: reactions balance the loads",
        show(-a for a in applied),
        show(total),
        miss < 1e-6 * size,
    )


def pulled(root: Path, order: int) -> list[Row]:
    """Quarter bar on two symmetry planes, held along x at the start, pulled by a force on the
    end face: uniform stress F/A at every node, reaction -F at the start."""
    mesh, topo = prepare(root, "bar", bar, order, 0.005)
    start = face(topo, lambda x, y, z: abs(x) < 1e-6)
    end = face(topo, lambda x, y, z: abs(x - L) < 1e-6)
    sym_y = face(topo, lambda x, y, z: abs(y) < 1e-6)
    sym_z = face(topo, lambda x, y, z: abs(z) < 1e-6)
    s = spec(
        [
            frictionless("sym", [sym_y, sym_z]),
            {
                "id": "start",
                "type": "displacement",
                "name": "start",
                "faces": [start],
                "x": q(0, "mm"),
                "y": "free",
                "z": "free",
            },
        ],
        [
            {
                "id": "pull",
                "type": "force",
                "name": "pull",
                "faces": [end],
                "x": q(PULL_KN, "kN"),
                "y": q(0, "kN"),
                "z": q(0, "kN"),
            }
        ],
        density=False,
    )
    fields, result = solve(s, mesh, root / f"pulled-p{order}")
    force = PULL_KN * 1000
    sigma = force / A_SI
    worst = max(rel(v, sigma) for v in von_mises_field(fields))
    eps = sigma / E_SI
    p = mesh.positions
    off = max(abs(fields.displacement[3 * n] - eps * p[3 * n]) for n in range(mesh.node_count))
    nodal = force_loads(s, mesh)
    total = [sum(f[i] for f in nodal.values()) for i in range(3)]
    r = {x.support_id: x.force for x in result.reactions}
    return [
        (
            f"p{order} pulled: nodal loads add up to the force",
            f"{force:.6g}, 0, 0 N",
            show(total),
            rel(total[0], force) < 1e-12 and max(map(abs, total[1:])) == 0.0,
        ),
        (
            f"p{order} pulled: von Mises F/A at every node",
            f"{sigma:.6g} Pa",
            f"worst {worst:.2e}",
            worst < 1e-4,
        ),
        (
            f"p{order} pulled: x displacement eps·x at every node",
            "0 m",
            f"{off:.2e} m",
            off < 1e-5 * eps * L / 1000,
        ),
        (
            f"p{order} pulled: start reaction",
            f"{-force:.6g}, 0, 0 N",
            show(r["start"]),
            math.dist(r["start"], (-force, 0, 0)) < 1e-6 * force,
        ),
        (
            f"p{order} pulled: symmetry planes carry nothing",
            "0 N",
            show(r["sym"]),
            max(map(abs, r["sym"])) < 1e-6 * force,
        ),
    ]


def heated(root: Path, order: int) -> list[Row]:
    """Bar warmed by 90 °F. Held on three planes through the origin it grows freely: every
    node moves by alpha·dT times its position and nothing is stressed. Held at both ends as
    well, its axial stress is -E·alpha·dT at every node and each end pushes back with that
    stress times the section. Fields are compared to the .frd file's printed digits, as in
    pulled()."""
    mesh, topo = prepare(root, "bar", bar, order, 0.005)
    start = face(topo, lambda x, y, z: abs(x) < 1e-6)
    end = face(topo, lambda x, y, z: abs(x - L) < 1e-6)
    sym_y = face(topo, lambda x, y, z: abs(y) < 1e-6)
    sym_z = face(topo, lambda x, y, z: abs(z) < 1e-6)
    warm = {"id": "warm", "type": "temperature", "name": "warm", "change": q(90, "°F")}
    strain = ALPHA * DELTA_T
    sigma = E_SI * strain
    p = mesh.positions
    rows: list[Row] = []

    free = spec([frictionless("planes", [start, sym_y, sym_z])], [warm], False, True)
    fields, result = solve(free, mesh, root / f"heated-free-p{order}")
    off = max(
        abs(fields.displacement[3 * n + i] - strain * p[3 * n + i])
        for n in range(mesh.node_count)
        for i in range(3)
    )
    mises = max(von_mises_field(fields))
    (r,) = [x.force for x in result.reactions]
    rows += [
        (
            f"p{order} heated, free: displacement alpha·dT·x at every node",
            "0 m",
            f"{off:.2e} m",
            off < 1e-5 * strain * L / 1000,
        ),
        (
            f"p{order} heated, free: no stress",
            "0 Pa",
            f"{mises:.2e} Pa",
            mises < 1e-6 * sigma,
        ),
        (
            f"p{order} heated, free: no reaction",
            "0 N",
            show(r),
            max(map(abs, r)) < 1e-6 * sigma * A_SI,
        ),
    ]

    held = spec(
        [
            frictionless("start", [start]),
            frictionless("end", [end]),
            frictionless("sym", [sym_y, sym_z]),
        ],
        [warm],
        False,
        True,
    )
    fields, result = solve(held, mesh, root / f"heated-held-p{order}")
    s = fields.stress
    worst = max(
        max(abs(s[6 * n] + sigma), *(abs(v) for v in s[6 * n + 1 : 6 * n + 6])) / sigma
        for n in range(mesh.node_count)
    )
    lateral = max(
        abs(fields.displacement[3 * n + i] - (1 + NU) * strain * p[3 * n + i])
        for n in range(mesh.node_count)
        for i in (1, 2)
    )
    r = {x.support_id: x.force for x in result.reactions}
    push = sigma * A_SI
    rows += [
        (
            f"p{order} heated, held: stress -E·alpha·dT along x, nothing else, at every node",
            f"{-sigma:.6g} Pa",
            f"worst {worst:.2e}",
            worst < 1e-4,
        ),
        (
            f"p{order} heated, held: grows (1 + nu)·alpha·dT across",
            "0 m",
            f"{lateral:.2e} m",
            lateral < 1e-5 * (1 + NU) * strain * H / 1000,
        ),
        (
            f"p{order} heated, held: end reactions push back on the bar",
            f"{push:.6g}, 0, 0 N and {-push:.6g}, 0, 0 N",
            f"{show(r['start'])} and {show(r['end'])}",
            math.dist(r["start"], (push, 0, 0)) < 1e-6 * push
            and math.dist(r["end"], (-push, 0, 0)) < 1e-6 * push,
        ),
        (
            f"p{order} heated, held: symmetry planes carry nothing",
            "0 N",
            show(r["sym"]),
            max(map(abs, r["sym"])) < 1e-6 * push,
        ),
    ]
    return rows


def self_weight(root: Path, order: int) -> list[Row]:
    """Column standing on its fixed base under gravity: base reaction = weight, and the stress
    at mid-height is rho g h/2."""
    mesh, topo = prepare(root, "column", column, order, 0.005)
    base = face(topo, lambda x, y, z: abs(z) < 1e-6)
    s = spec([{"id": "base", "type": "fixed", "name": "base", "faces": [base]}], [gravity()])
    fields, result = solve(s, mesh, root / f"weighed-p{order}")
    weight = RHO * G * A_SI * L / 1000
    (r,) = [x.force for x in result.reactions]
    mises = von_mises_field(fields)
    p = mesh.positions
    middle = [mises[n] for n in range(mesh.node_count) if abs(p[3 * n + 2] * 1000 - L / 2) < 1e-6]
    sigma = RHO * G * L / 2000
    worst = max(rel(v, sigma) for v in middle)
    # Four-node tetrahedra have one stress per element, so a stress that varies along the
    # column is only approximated at the nodes; ten-node ones reproduce it.
    limit = 1e-3 if order == 2 else 1e-2
    return [
        (
            f"p{order} column: base reaction = weight",
            f"0, 0, {weight:.6g} N",
            show(r),
            math.dist(r, (0, 0, weight)) < 1e-6 * weight,
        ),
        balance_row(f"p{order} column", s, mesh, result),
        (
            f"p{order} column: von Mises rho·g·h/2 at mid-height",
            f"{sigma:.6g} Pa",
            f"worst {worst:.2e} over {len(middle)} nodes",
            worst < limit,
        ),
    ]


def spinning(root: Path, order: int) -> list[Row]:
    """Quarter ring on symmetry planes x = 0 and y = 0 and the mid-plane z = 0, spun about z
    and pulled down by gravity, then pushed sideways by a force on its curved outer face."""
    mesh, topo = prepare(root, "ring", ring, order, 0.0025)
    sym_x = face(topo, lambda x, y, z: abs(x) < 1e-6)
    sym_y = face(topo, lambda x, y, z: abs(y) < 1e-6)
    bottom = face(topo, lambda x, y, z: abs(z) < 1e-6)
    outside = face(
        topo, lambda x, y, z: abs(z - T / 2) < 1e-6 and min(x, y) > 1 and math.hypot(x, y) > 86
    )
    supports = [
        frictionless("sym-x", [sym_x]),
        frictionless("sym-y", [sym_y]),
        frictionless("bottom", [bottom]),
    ]
    s = spec(supports, [spin(), gravity()])
    fields, result = solve(s, mesh, root / f"spun-p{order}")
    omega = RPM * 2 * math.pi / 60
    a, b, t = A / 1000, B / 1000, T / 1000
    r = {x.support_id: x.force for x in result.reactions}
    hoop = RHO * omega**2 * t * (b**3 - a**3) / 3  # each cut plane's x or y reaction
    weight = RHO * G * math.pi / 4 * (b * b - a * a) * t
    # Plane stress rotating disc (Timoshenko and Goodier, rotating discs), at r = b.
    s_b = RHO * omega**2 * ((3 + NU) * a * a + (1 - NU) * b * b) / 4
    p = mesh.positions
    outer = [
        n for n in range(mesh.node_count) if abs(math.hypot(p[3 * n], p[3 * n + 1]) - b) < 1e-7
    ]
    mises = von_mises_field(fields)
    worst_s = max(rel(mises[n], s_b) for n in outer)
    radial = [
        (fields.displacement[3 * n] * p[3 * n] + fields.displacement[3 * n + 1] * p[3 * n + 1]) / b
        for n in outer
    ]
    worst_u = max(rel(u, b * s_b / E_SI) for u in radial)
    limit = 0.01 if order == 2 else 0.03  # constant-stress four-node tetrahedra, as above
    rows = [
        balance_row(f"p{order} ring spun and weighed", s, mesh, result),
        (
            f"p{order} ring: cut plane x = 0 carries rho·w²·t·(b³-a³)/3",
            f"{-hoop:.6g} N along x",
            show(r["sym-x"]),
            rel(r["sym-x"][0], -hoop) < 1e-3,
        ),
        (
            f"p{order} ring: cut plane y = 0 the same along y",
            f"{-hoop:.6g} N along y",
            show(r["sym-y"]),
            rel(r["sym-y"][1], -hoop) < 1e-3,
        ),
        (
            f"p{order} ring: mid-plane carries the weight",
            f"0, 0, {weight:.6g} N",
            show(r["bottom"]),
            rel(r["bottom"][2], weight) < 1e-3,
        ),
        (
            f"p{order} ring: von Mises at r = b (plane stress disc)",
            f"{s_b:.6g} Pa",
            f"worst {worst_s:.2e} over {len(outer)} nodes",
            worst_s < limit,
        ),
        (
            f"p{order} ring: radial displacement b·sigma/E at r = b",
            f"{b * s_b / E_SI:.6g} m",
            f"worst {worst_u:.2e}",
            worst_u < 0.01,
        ),
    ]
    # A sideways force on the curved outer face, held by a fixed bottom: the force reaches
    # held nodes along the bottom edge, so the reaction is only right with them taken out.
    fixed = spec(
        [{"id": "bottom", "type": "fixed", "name": "bottom", "faces": [bottom]}],
        [
            {
                "id": "push",
                "type": "force",
                "name": "push",
                "faces": [outside],
                "x": q(-3, "kN"),
                "y": q(1, "kN"),
                "z": q(2, "kN"),
            }
        ],
        density=False,
    )
    _, pushed = solve(fixed, mesh, root / f"ring-pushed-p{order}")
    (reaction,) = [x.force for x in pushed.reactions]
    rows.append(
        (
            f"p{order} ring pushed on its curved face: fixed bottom reaction",
            "3000, -1000, -2000 N",
            show(reaction),
            math.dist(reaction, (3000, -1000, -2000)) < 1e-6 * 3742,
        )
    )
    return rows


def cross(a, b) -> list[float]:  # type: ignore[no-untyped-def]
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def moment_about(mesh: VolumeMesh, forces, point) -> list[float]:  # type: ignore[no-untyped-def]
    """The moment about ``point`` (m) of nodal forces (0-based node -> N)."""
    p = mesh.positions
    total = [0.0, 0.0, 0.0]
    for node, f in forces.items():
        m = cross([p[3 * node + i] - point[i] for i in range(3)], f)
        for i in range(3):
            total[i] += m[i]
    return total


def remote_load(root: Path, order: int) -> list[Row]:
    """Column held at its base (a zero prescribed displacement, so the reactions are printed
    node by node), loaded on its top through a point off to the side and above it: the nodal
    loads have the force and, about the point, the moment; the base reaction balances both;
    and the axial stress at mid-height is the beam's N/A + bending."""
    mesh, topo = prepare(root, "column", column, order, 0.005)
    base = face(topo, lambda x, y, z: abs(z) < 1e-6)
    top = face(topo, lambda x, y, z: abs(z - L) < 1e-6)

    def xyz(v, unit):  # type: ignore[no-untyped-def]
        return {a: q(c, unit) for a, c in zip("xyz", v, strict=True)}

    s = spec(
        [
            {
                "id": "base",
                "type": "displacement",
                "name": "base",
                "faces": [base],
                "x": q(0, "mm"),
                "y": q(0, "mm"),
                "z": q(0, "mm"),
            }
        ],
        [
            {
                "id": "remote",
                "type": "remote",
                "name": "remote",
                "faces": [top],
                "point": xyz(REMOTE_POINT, "mm"),
                "force": xyz(REMOTE_FORCE, "N"),
                "moment": xyz(REMOTE_MOMENT, "N·m"),
            }
        ],
        density=False,
    )
    work = root / f"remote-p{order}"
    fields, result = solve(s, mesh, work)
    point = [c / 1000 for c in REMOTE_POINT]
    f, m = REMOTE_FORCE, REMOTE_MOMENT
    size_f, size_m = math.hypot(*f), math.hypot(*m)
    nodal = force_loads(s, mesh)
    total = [sum(v[i] for v in nodal.values()) for i in range(3)]
    turning = moment_about(mesh, nodal, point)
    # The base holds every node of its face; none carries load, so RF is the reaction.
    rf = read_node_forces(work / "job.dat", REACTION_SET)
    reaction = [sum(v[i] for v in rf.values()) for i in range(3)]
    reaction_m = moment_about(mesh, rf, point)
    (r,) = [x.force for x in result.reactions]
    # Beam theory at mid-height: the section at z = L/2 carries the load's force and its
    # moment about the section's centre c, M + (P - c) x F. Axial stress at (x, y):
    # Fz/A + Mx (y - yc)/I - My (x - xc)/I, with I = H^4/12 (Saint-Venant, far from both ends).
    c = (H / 2000, H / 2000, L / 2000)
    inner = cross([point[i] - c[i] for i in range(3)], f)
    mx, my = m[0] + inner[0], m[1] + inner[1]
    i_ = (H / 1000) ** 4 / 12
    pos = mesh.positions
    stress = fields.stress
    middle = [n for n in range(mesh.node_count) if abs(pos[3 * n + 2] * 1000 - L / 2) < 1e-6]
    peak = abs(f[2]) / A_SI + (abs(mx) + abs(my)) * (H / 2000) / i_
    worst = 0.0
    for n in middle:
        x, y = pos[3 * n] - c[0], pos[3 * n + 1] - c[1]
        beam = f[2] / A_SI + mx * y / i_ - my * x / i_
        worst = max(worst, abs(stress[6 * n + 2] - beam) / peak)
    # The moments in the check are of size M plus the arm to the base times F, which cancel
    # down to M; the printed reactions have seven digits, so the miss is measured against it.
    scale = size_m + math.dist(point, (c[0], c[1], 0.0)) * size_f
    rows = [
        (
            f"p{order} remote: nodal loads add up to the force",
            show(f) + " N",
            show(total),
            math.dist(total, f) < 1e-12 * size_f,
        ),
        (
            f"p{order} remote: nodal loads' moment about the point",
            show(m) + " N·m",
            show(turning),
            math.dist(turning, m) < 1e-12 * size_m,
        ),
        (
            f"p{order} remote: base reaction",
            show(-v for v in f) + " N",
            show(r),
            math.dist(r, [-v for v in f]) < 1e-6 * size_f and math.dist(reaction, r) < 1e-9,
        ),
        (
            f"p{order} remote: base reaction's moment about the point",
            show(-v for v in m) + " N·m",
            show(reaction_m),
            math.dist(reaction_m, [-v for v in m]) < 1e-6 * scale,
        ),
    ]
    # Four-node tetrahedra have constant strain, so they cannot bend a section that is four
    # elements across (they come out about a quarter too stiff here); only ten-node ones are
    # compared with beam theory.
    if order == 2:
        rows.append(
            (
                f"p{order} remote: axial stress at mid-height from beam theory",
                f"peak {peak:.6g} Pa",
                f"worst {worst:.2e} of peak over {len(middle)} nodes",
                worst < 2e-3,
            )
        )
    return rows


def water(id_: str, faces: list[int], level: float) -> dict:
    """Water under -1 g with its free surface at z = ``level`` mm."""
    return {
        "id": id_,
        "type": "hydrostatic",
        "name": id_,
        "faces": faces,
        "fluidDensity": q(WATER, "kg/m³"),
        "gravity": {"x": q(0, "g"), "y": q(0, "g"), "z": q(-1, "g")},
        "freeSurface": {"x": q(0, "mm"), "y": q(0, "mm"), "z": q(level, "mm")},
    }


def hydrostatic(root: Path, order: int) -> list[Row]:
    """Column on its fixed base under water. Sunk with every face wet (the held base too), the
    nodal loads must be Archimedes' buoyancy rho g V upwards with no moment about the centre,
    exact for flat faces; wet on one side up to LEVEL, they must be rho g H h^2/2 across, with
    the free surface crossing the side. Both times the base reaction balances the loads."""
    mesh, topo = prepare(root, "column", column, order, 0.005)
    base = face(topo, lambda x, y, z: abs(z) < 1e-6)
    side = face(topo, lambda x, y, z: abs(x) < 1e-6)
    fixed = [{"id": "base", "type": "fixed", "name": "base", "faces": [base]}]
    every = [f.tag for f in topo.faces]
    rows: list[Row] = []

    sunk = spec(fixed, [water("sunk", every, L + 100)], density=False)
    nodal = force_loads(sunk, mesh)
    total = [sum(v[i] for v in nodal.values()) for i in range(3)]
    lift = WATER * G * A_SI * L / 1000
    turning = moment_about(mesh, nodal, (H / 2000, H / 2000, L / 2000))
    _, result = solve(sunk, mesh, root / f"sunk-p{order}")
    rows += [
        (
            f"p{order} sunk: nodal loads are the buoyancy",
            f"0, 0, {lift:.6g} N",
            show(total),
            math.dist(total, (0, 0, lift)) < 1e-12 * lift,
        ),
        (
            f"p{order} sunk: no moment about the centre",
            "0, 0, 0 N·m",
            show(turning),
            math.hypot(*turning) < 1e-12 * lift * L / 1000,
        ),
        balance_row(f"p{order} sunk", sunk, mesh, result),
    ]

    wet = spec(fixed, [water("side", [side], LEVEL)], density=False)
    nodal = force_loads(wet, mesh)
    total = [sum(v[i] for v in nodal.values()) for i in range(3)]
    push = WATER * G * (H / 1000) * (LEVEL / 1000) ** 2 / 2
    _, result = solve(wet, mesh, root / f"side-p{order}")
    # The free surface crosses element faces, whose wet part is found by splitting them
    # (loads/hydrostatic.py), so the total is close but not exact.
    rows += [
        (
            f"p{order} side: nodal loads are rho g H h^2/2",
            f"{push:.6g}, 0, 0 N",
            show(total),
            math.dist(total, (push, 0, 0)) < 1e-5 * push,
        ),
        balance_row(f"p{order} side", wet, mesh, result),
    ]
    return rows


def refusals(root: Path) -> list[Row]:
    mesh, topo = prepare(root, "short-column", column, 1, 0.01)
    base = [
        {
            "id": "base",
            "type": "fixed",
            "name": "base",
            "faces": [face(topo, lambda x, y, z: abs(z) < 1e-6)],
        }
    ]
    cases = [
        ("gravity without a density", spec(base, [gravity()], density=False), "has no density"),
        ("two centrifugal loads", spec(base, [spin("a"), spin("b")]), "is a second one"),
        (
            "an axis with no direction",
            spec(base, [spin(direction=(0.0, 0.0, 0.0))]),
            "axis direction is zero",
        ),
        (
            "gravity missing a component",
            spec(base, [{**gravity(), "y": None}]),
            "y component has no value",
        ),
        (
            "a remote load missing a moment component",
            spec(
                base,
                [
                    {
                        "id": "r",
                        "type": "remote",
                        "name": "r",
                        "faces": base[0]["faces"],
                        "point": {"x": q(0, "mm"), "y": q(0, "mm"), "z": q(0, "mm")},
                        "force": {"x": q(0, "N"), "y": q(0, "N"), "z": q(1, "N")},
                        "moment": {"x": q(0, "N·m"), "y": None, "z": q(0, "N·m")},
                    }
                ],
            ),
            "y component of its moment has no value",
        ),
        (
            "water whose faces are above its free surface",
            spec(base, [water("w", base[0]["faces"], -1)], density=False),
            "all above the free surface",
        ),
    ]
    rows = []
    for name, s, expected in cases:
        try:
            generate_deck(s, mesh)
            got = "deck written"
        except DeckError as error:
            got = str(error)
        rows.append((f"refused: {name}", expected, got[:90], expected in got))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    root = args.out or Path(tempfile.mkdtemp(prefix="load-check-"))
    root.mkdir(parents=True, exist_ok=True)
    rows: list[Row] = []
    for order in (1, 2):
        rows += pulled(root, order)
        rows += self_weight(root, order)
        rows += spinning(root, order)
        rows += remote_load(root, order)
        rows += hydrostatic(root, order)
        rows += heated(root, order)
    rows += refusals(root)
    print("| Check | Expected | Got | OK |\n| --- | --- | --- | --- |")
    for name, expected, got, ok in rows:
        print(f"| {name} | {expected} | {got} | {'yes' if ok else 'NO'} |")
    failed = sum(not ok for *_, ok in rows)
    print(f"\n{len(rows) - failed} of {len(rows)} checks pass. Files in {root}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
