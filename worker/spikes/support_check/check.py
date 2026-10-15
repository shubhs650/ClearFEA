# SPDX-License-Identifier: AGPL-3.0-or-later
"""M2.2 support check: solve bars held by prescribed displacements and frictionless supports
with CalculiX and compare with closed-form answers (ADR-039).

Script only, like spikes/deck_check and spikes/solve_check (the fast tier runs no solver). It
checks what the deck generator and result reader alone decide for the new supports: a
prescribed value reaches the nodes, a frictionless face slides in its plane and not along its
normal (on an inclined plane through *TRANSFORM too), reactions are shared between supports
that meet at an edge, and setups that leave the part free or ask for two motions at once are
refused. Since M2.6 it also checks the elastic support: grounded springs along a leaning
face's normal, at nodes that a frictionless plane holds through local axes too, and the
support's reaction.

    cd worker && uv run python spikes/support_check/check.py [--out DIR]

Needs Gmsh's system libraries and `ccx` on the PATH. Exit status is non-zero if a check fails.
"""

import argparse
import math
import sys
import tempfile
import threading
from pathlib import Path

from clearfea_worker.deck import DeckError, generate_deck
from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import mesh_geometry
from clearfea_worker.meshing.volume import VolumeMesh, read_volume_mesh
from clearfea_worker.results import read_results
from clearfea_worker.results.fields import von_mises_field
from clearfea_worker.solver import run_calculix
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: Bar in millimetres: length L along its own x axis, square section H, turned by ANGLE about z.
L, H = 200.0, 20.0
E_SI, NU = 2.1e11, 0.3
STRETCH_MM = 0.1  # prescribed end displacement
PULL_MPA = 50.0  # tension on the far end of the turned bar (entered as a negative pressure)
A_SI = (H / 1000) ** 2

Row = tuple[str, str, str, bool]


def write_bar(path: Path, angle: float) -> Path:
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        box = gmsh.model.occ.addBox(0, 0, 0, L, H, H)
        if angle:
            gmsh.model.occ.rotate([(3, box)], 0, 0, 0, 0, 0, 1, math.radians(angle))
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def bar_faces(topology: Topology, angle: float) -> dict[str, int]:
    """Faces by name in the bar's own axes (x-, x+, y-, ...), found from their centroids."""
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    named = {}
    for face in topology.faces:
        x, y, z = (v * 1000 for v in face.centroid)
        local = (c * x + s * y, -s * x + c * y, z)
        for axis, size in enumerate((L, H, H)):
            for side, bound in (("-", 0.0), ("+", size)):
                if math.isclose(local[axis], bound, abs_tol=1e-6):
                    named[f"{'xyz'[axis]}{side}"] = face.tag
    assert len(named) == 6, named
    return named


def spec(supports: list[dict], loads: list[dict]) -> SimulationSpec:
    return SimulationSpec.model_validate(
        {
            "version": 1,
            "analysis": "linear_static",
            "geometryId": "support-check",
            "bodies": [{"tag": 1, "material": "steel"}],
            "materials": [
                {
                    "id": "steel",
                    "name": "Steel",
                    "model": "isotropic_elastic",
                    "youngsModulus": {"value": 210, "unit": "GPa"},
                    "poissonsRatio": NU,
                }
            ],
            "supports": supports,
            "loads": loads,
            "mesh": {"size": {"value": 5, "unit": "mm"}},
        }
    )


def frictionless(id_: str, faces: list[int]) -> dict:
    return {"id": id_, "type": "frictionless", "name": id_, "faces": faces}


def displacement(id_: str, faces: list[int], x, y="free", z="free") -> dict:  # type: ignore[no-untyped-def]
    return {"id": id_, "type": "displacement", "name": id_, "faces": faces, "x": x, "y": y, "z": z}


def mm(value: float) -> dict:
    return {"value": value, "unit": "mm"}


def solve(spec_: SimulationSpec, mesh: VolumeMesh, work: Path):  # type: ignore[no-untyped-def]
    work.mkdir(parents=True)
    deck = work / "job.inp"
    deck.write_text(generate_deck(spec_, mesh))
    run = run_calculix(deck, lambda line: None, threading.Event())
    if run.returncode != 0 or run.errors():
        raise RuntimeError(f"CalculiX failed in {work}: {run.errors()}")
    return read_results(spec_, mesh, work / "job.frd", work / "job.dat", "check")


def rel(a: float, b: float) -> float:
    return abs(a - b) / abs(b)


def prepare(root: Path, angle: float, order: int) -> tuple[VolumeMesh, dict[str, int]]:
    folder = root / f"bar-{angle:g}-p{order}"
    step = write_bar(folder.with_suffix(".step"), angle)
    import_geometry(step, folder / "import", None)
    topology = Topology.model_validate_json((folder / "import" / "topology.json").read_bytes())
    out = mesh_geometry(
        step, topology, folder / "mesh", scaling=1.0, size=0.005, unit="mm", order=order
    )
    return read_volume_mesh(out.mesh_path), bar_faces(topology, angle)


def stretched(root: Path, order: int) -> list[Row]:
    """Quarter-model bar on two symmetry planes, both ends held by prescribed displacements."""
    mesh, f = prepare(root, 0.0, order)
    s = spec(
        [
            frictionless("sym", [f["y-"], f["z-"]]),
            displacement("start", [f["x-"]], mm(0)),
            displacement("end", [f["x+"]], {"value": STRETCH_MM / 10, "unit": "cm"}),
        ],
        [],
    )
    fields, result = solve(s, mesh, root / f"stretched-p{order}")
    sigma = E_SI * STRETCH_MM / L
    mises = von_mises_field(fields)
    worst = max(rel(v, sigma) for v in mises)
    p = mesh.positions
    contraction = -NU * STRETCH_MM / L  # lateral strain
    lateral = max(
        abs(fields.displacement[3 * n + 1] - contraction * p[3 * n + 1])
        + abs(fields.displacement[3 * n + 2] - contraction * p[3 * n + 2])
        for n in range(mesh.node_count)
    )
    r = {x.support_id: x.force for x in result.reactions}
    force = sigma * A_SI
    total = [sum(v[i] for v in r.values()) for i in range(3)]
    return [
        (
            f"p{order} stretched: von Mises Ed/L at every node",
            f"{sigma:.6g} Pa",
            f"worst {worst:.2e}",
            worst < 1e-4,
        ),
        (
            f"p{order} stretched: sides contract by nu·eps·y, nu·eps·z",
            "0 m",
            f"{lateral:.2e} m",
            lateral < 1e-5 * STRETCH_MM / 1000,
        ),
        (
            f"p{order} stretched: end reaction",
            f"{force:.6g}, 0, 0 N",
            ", ".join(f"{v:.6g}" for v in r["end"]),
            rel(r["end"][0], force) < 1e-6 and max(map(abs, r["end"][1:])) < 1e-6 * force,
        ),
        (
            f"p{order} stretched: start reaction",
            f"{-force:.6g}, 0, 0 N",
            ", ".join(f"{v:.6g}" for v in r["start"]),
            rel(r["start"][0], -force) < 1e-6,
        ),
        (
            f"p{order} stretched: symmetry planes carry nothing",
            "0 N",
            ", ".join(f"{v:.3g}" for v in r["sym"]),
            max(map(abs, r["sym"])) < 1e-6 * force,
        ),
        (
            f"p{order} stretched: reactions balance",
            "0 N",
            ", ".join(f"{v:.3g}" for v in total),
            max(map(abs, total)) < 1e-6 * force,
        ),
    ]


def turned(root: Path, order: int) -> list[Row]:
    """The bar turned 30° about z: its start and one side on inclined frictionless planes,
    the base on z = 0, pulled by a uniform tension on the far end."""
    angle = 30.0
    mesh, f = prepare(root, angle, order)
    s = spec(
        [
            frictionless("start", [f["x-"]]),
            frictionless("side", [f["y-"]]),
            frictionless("base", [f["z-"]]),
        ],
        [
            {
                "id": "pull",
                "type": "pressure",
                "name": "pull",
                "faces": [f["x+"]],
                "magnitude": {"value": -PULL_MPA, "unit": "MPa"},
            }
        ],
    )
    fields, result = solve(s, mesh, root / f"turned-p{order}")
    sigma = PULL_MPA * 1e6
    mises = von_mises_field(fields)
    worst = max(rel(v, sigma) for v in mises)
    c, sn = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    eps = sigma / E_SI
    p = mesh.positions
    off = 0.0
    for n in range(mesh.node_count):
        x, y, z = p[3 * n : 3 * n + 3]
        lx, ly = c * x + sn * y, -sn * x + c * y
        ux, uy, uz = (eps * lx, -NU * eps * ly, -NU * eps * z)  # in the bar's axes
        exact = (c * ux - sn * uy, sn * ux + c * uy, uz)
        off = max(off, max(abs(fields.displacement[3 * n + i] - exact[i]) for i in range(3)))
    force = sigma * A_SI
    r = {x.support_id: x.force for x in result.reactions}
    return [
        (
            f"p{order} turned: von Mises = tension at every node",
            f"{sigma:.6g} Pa",
            f"worst {worst:.2e}",
            worst < 1e-4,
        ),
        (
            f"p{order} turned: displacement field exact",
            "0 m",
            f"{off:.2e} m",
            off < 1e-5 * eps * L / 1000,
        ),
        (
            f"p{order} turned: start reaction along the bar",
            f"{-force * c:.6g}, {-force * sn:.6g}, 0 N",
            ", ".join(f"{v:.6g}" for v in r["start"]),
            math.dist(r["start"], (-force * c, -force * sn, 0)) < 1e-6 * force,
        ),
        (
            f"p{order} turned: side and base carry nothing",
            "0 N",
            ", ".join(f"{v:.3g}" for v in (*r["side"], *r["base"])),
            max(map(abs, (*r["side"], *r["base"]))) < 1e-6 * force,
        ),
    ]


#: Foundation stiffness and the pressure pushing the turned bar into it (M2.6).
K_N_MM3, PRESS_MPA = 1000.0, 10.0


def on_foundation(root: Path, order: int) -> list[Row]:
    """The turned bar with its leaning side y- on an elastic support (M2.6), the start and the
    base on frictionless planes, pressed into the foundation by a pressure on the side y+."""
    angle = 30.0
    mesh, f = prepare(root, angle, order)
    s = spec(
        [
            frictionless("start", [f["x-"]]),
            frictionless("base", [f["z-"]]),
            {
                "id": "soil",
                "type": "elastic",
                "name": "soil",
                "faces": [f["y-"]],
                "stiffness": {"value": K_N_MM3, "unit": "N/mm³"},
            },
        ],
        [
            {
                "id": "press",
                "type": "pressure",
                "name": "press",
                "faces": [f["y+"]],
                "magnitude": {"value": PRESS_MPA, "unit": "MPa"},
            }
        ],
    )
    fields, result = solve(s, mesh, root / f"foundation-p{order}")
    sigma = PRESS_MPA * 1e6
    k = K_N_MM3 * 1e9
    mises = von_mises_field(fields)
    worst = max(rel(v, sigma) for v in mises)
    c, sn = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    eps = sigma / E_SI
    settle = sigma / k
    p = mesh.positions
    off = 0.0
    for n in range(mesh.node_count):
        x, y, z = p[3 * n : 3 * n + 3]
        lx, ly = c * x + sn * y, -sn * x + c * y
        # Uniform compression across the bar on a foundation that gives way by p / k.
        ux, uy, uz = (NU * eps * lx, -settle - eps * ly, NU * eps * z)
        exact = (c * ux - sn * uy, sn * ux + c * uy, uz)
        off = max(off, max(abs(fields.displacement[3 * n + i] - exact[i]) for i in range(3)))
    force = sigma * L * H / 1e6
    r = {x.support_id: x.force for x in result.reactions}
    return [
        (
            f"p{order} foundation: von Mises = pressure at every node",
            f"{sigma:.6g} Pa",
            f"worst {worst:.2e}",
            worst < 1e-4,
        ),
        (
            f"p{order} foundation: settles by p/k, displacement field exact",
            f"{settle:.6g} m settlement, 0 m off",
            f"{off:.2e} m off",
            off < 1e-5 * settle,
        ),
        (
            f"p{order} foundation: elastic support pushes back p·A along the side's normal",
            f"{-force * sn:.6g}, {force * c:.6g}, 0 N",
            ", ".join(f"{v:.6g}" for v in r["soil"]),
            math.dist(r["soil"], (-force * sn, force * c, 0)) < 1e-5 * force,
        ),
        (
            f"p{order} foundation: start and base carry nothing",
            "0 N",
            ", ".join(f"{v:.3g}" for v in (*r["start"], *r["base"])),
            max(map(abs, (*r["start"], *r["base"]))) < 1e-5 * force,
        ),
    ]


def refusals(root: Path) -> list[Row]:
    mesh, f = prepare(root, 0.0, 1)
    pull = [
        {
            "id": "p",
            "type": "pressure",
            "name": "p",
            "faces": [f["x+"]],
            "magnitude": {"value": -1, "unit": "MPa"},
        }
    ]
    rows = []
    cases = [
        (
            "one symmetry plane leaves the part free",
            spec([frictionless("sym", [f["x-"]])], pull),
            "slide along y, slide along z and turn about the x axis",
        ),
        (
            "an elastic support alone on one face leaves the part free",
            spec(
                [
                    {
                        "id": "e",
                        "type": "elastic",
                        "name": "e",
                        "faces": [f["z-"]],
                        "stiffness": {"value": 1, "unit": "N/mm³"},
                    }
                ],
                pull,
            ),
            "slide along x, slide along y and turn about the z axis",
        ),
        (
            "all components free holds nothing",
            spec([displacement("d", [f["x-"]], "free")], pull),
            "leaves every component free",
        ),
        (
            "fixed face and a moved neighbour disagree",
            spec(
                [
                    {"id": "f", "type": "fixed", "name": "f", "faces": [f["x-"]]},
                    displacement("d", [f["y-"]], "free", mm(0.1)),
                ],
                pull,
            ),
            "ask it to move in different ways",
        ),
        (
            "a prescribed move along a frictionless normal disagrees",
            spec(
                [
                    frictionless("sym", [f["x-"], f["y-"], f["z-"]]),
                    displacement("d", [f["y+"]], mm(0.1)),
                ],
                pull,
            ),
            "ask it to move in different ways",
        ),
    ]
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
    root = args.out or Path(tempfile.mkdtemp(prefix="support-check-"))
    root.mkdir(parents=True, exist_ok=True)
    rows: list[Row] = []
    for order in (1, 2):
        rows += stretched(root, order)
        rows += turned(root, order)
        rows += on_foundation(root, order)
    rows += refusals(root)
    print("| Check | Expected | Got | OK |\n| --- | --- | --- | --- |")
    for name, expected, got, ok in rows:
        print(f"| {name} | {expected} | {got} | {'yes' if ok else 'NO'} |")
    failed = sum(not ok for *_, ok in rows)
    print(f"\n{len(rows) - failed} of {len(rows)} checks pass. Files in {root}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
