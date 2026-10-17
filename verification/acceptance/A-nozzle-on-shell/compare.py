# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reads case A's stresses at fixed points from CalculiX result files, and compares two of them.

    cd worker
    uv run python ../verification/acceptance/A-nozzle-on-shell/compare.py \\
        clearfea=results.frd:si freecad=Mesh.frd:mm [--json OUT]

Each argument is ``label=path:units``, ``si`` for a file in metres and pascals (ClearFEA's raw
output) or ``mm`` for one in millimetres and megapascals (FreeCAD's). With two files the table
gives the second's difference from the first.

The points (``POINTS``, millimetres) are where hand_checks.md compares: the membrane field far
from the nozzle, the shell at the pad's edge and at the nozzle's edge along (A, B) and around
(C, D) the shell, both surfaces, and the nozzle's wall 20 mm above the pad. A value is the
inverse-distance mean of the nodal stresses at the nodes of that surface within 6 mm of the
point, in the shell's or the nozzle's own axes. Nodal stresses are the solver's own,
extrapolated from the integration points and averaged at the nodes; ClearFEA's result pages
show the same values.
"""

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from clearfea_worker.results.frd import read_nodal_blocks

#: Nodes this far from a surface (mm) count as on it.
ON_SURFACE = 0.05
#: Nodes this close to a point (mm) are averaged for it.
NEAR = 6.0

Vec = tuple[float, float, float]


@dataclass(frozen=True)
class Point:
    name: str
    at: Vec
    #: The surface: a cylinder of this radius about the x axis (shell, pad) or the z axis (nozzle).
    axis: str
    radius: float


def _shell(name: str, x: float, y: float, radius: float) -> Point:
    """A point on the shell's (or pad's) cylinder of ``radius`` about x, above the axis."""
    return Point(name, (x, y, math.sqrt(radius**2 - y**2)), "x", radius)


def _points() -> list[Point]:
    pts = [
        Point("Far field, x = 450, outside", (450.0, 0.0, -310.0), "x", 310.0),
        Point("Far field, x = 450, inside", (450.0, 0.0, -300.0), "x", 300.0),
        Point("Held side, x = -400, top, outside", (-400.0, 0.0, 310.0), "x", 310.0),
        Point("Held side, x = -400, bottom, outside", (-400.0, 0.0, -310.0), "x", 310.0),
    ]
    # Along (A +x, B −x) and around (C +y, D −y) the shell, at an edge plus an offset.
    for edge, r0, out in (("Pad edge", 165.0, 310.0), ("Nozzle edge", 83.0, 320.0)):
        for offset in (0.0, 8.0):
            d = r0 + offset
            for side, (x, y) in {
                "A": (d, 0.0),
                "B": (-d, 0.0),
                "C": (0.0, d),
                "D": (0.0, -d),
            }.items():
                theta = math.asin(y / out)
                for surface, r in (("outside", out), ("inside", 300.0)):
                    name = f"{edge} +{offset:g}, {side}, {surface}"
                    pts.append(_shell(name, x, r * math.sin(theta), r))
    # The nozzle's wall 20 mm and 120 mm above the pad, around from +x towards +y.
    for z in (340.0, 440.0):
        for phi in (0, 90, 180, 270):
            a = math.radians(phi)
            at = (83 * math.cos(a), 83 * math.sin(a), z)
            pts.append(Point(f"Nozzle wall, z = {z:g}, {phi}°, outside", at, "z", 83.0))
    return pts


POINTS = _points()


@dataclass
class Result:
    nodes: dict[int, Vec]  # mm
    stress: dict[int, tuple[float, ...]]  # MPa: xx, yy, zz, xy, yz, zx
    disp: dict[int, Vec]  # mm


def read(path: Path, units: str) -> Result:
    """Node coordinates, displacements and stresses of a result file, in mm and MPa."""
    length, stress = {"si": (1e3, 1e-6), "mm": (1.0, 1.0)}[units]
    nodes: dict[int, Vec] = {}
    with path.open(encoding="ascii", errors="replace") as f:
        width = None
        for line in f:
            if line.startswith("    2C"):
                code = line[73:75].strip()
                width = 10 if code == "1" else 5
            elif width is not None and line.startswith(" -1"):
                n = int(line[3 : 3 + width])
                v = line[3 + width :].rstrip("\n")
                nodes[n] = tuple(float(v[k : k + 12]) * length for k in range(0, 36, 12))  # type: ignore[misc]
            elif width is not None and line.startswith(" -3"):
                break
    count = max(nodes)
    blocks = read_nodal_blocks(path, count, {"DISP", "STRESS"})
    sv, dv = blocks["STRESS"].values, blocks["DISP"].values
    ns, nd = len(blocks["STRESS"].components), len(blocks["DISP"].components)
    return Result(
        nodes=nodes,
        stress={n: tuple(sv[(n - 1) * ns + c] * stress for c in range(6)) for n in nodes},
        disp={n: tuple(dv[(n - 1) * nd + c] * length for c in range(3)) for n in nodes},  # type: ignore[misc]
    )


def _frame(p: Point, at: Vec) -> tuple[Vec, Vec]:
    """The along and around unit vectors of the surface at ``at``."""
    x, y, z = at
    if p.axis == "x":
        theta = math.atan2(y, z)
        return (1.0, 0.0, 0.0), (0.0, math.cos(theta), -math.sin(theta))
    phi = math.atan2(y, x)
    return (0.0, 0.0, 1.0), (-math.sin(phi), math.cos(phi), 0.0)


def _normal(s: tuple[float, ...], e: Vec) -> float:
    xx, yy, zz, xy, yz, zx = s
    a, b, c = e
    return xx * a * a + yy * b * b + zz * c * c + 2 * (xy * a * b + yz * b * c + zx * c * a)


def _mises(s: tuple[float, ...]) -> float:
    xx, yy, zz, xy, yz, zx = s
    return math.sqrt(
        0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy**2 + yz**2 + zx**2)
    )


def _on(p: Point, q: Vec) -> bool:
    r = math.hypot(q[1], q[2]) if p.axis == "x" else math.hypot(q[0], q[1])
    return abs(r - p.radius) < ON_SURFACE


def sample(res: Result, p: Point) -> dict[str, float]:
    """Along, around and von Mises stress at the point, MPa."""
    near = []
    for n, q in res.nodes.items():
        d = math.dist(q, p.at)
        if d < NEAR and _on(p, q):
            near.append((d, n))
    if not near:
        raise ValueError(f"no node of the surface within {NEAR} mm of {p.name}")
    weights = [(1 / max(d, 1e-6) ** 2, n) for d, n in near]
    total = sum(w for w, _ in weights)
    along, around = _frame(p, p.at)
    out = {"along": 0.0, "around": 0.0, "vonMises": 0.0}
    for w, n in weights:
        s = res.stress[n]
        out["along"] += w * _normal(s, along) / total
        out["around"] += w * _normal(s, around) / total
        out["vonMises"] += w * _mises(s) / total
    return out


def subtract(res: Result, other: Result) -> None:
    """Takes another result on the same mesh from ``res``: superposition, so one linear run
    minus another is the run of the loads that differ (ClearFEA's full run minus its
    piping-load-only run is the pressure and thrusts alone)."""
    if other.nodes != res.nodes:
        raise ValueError("the results to subtract are not on the same mesh")
    for n in res.nodes:
        res.stress[n] = tuple(a - b for a, b in zip(res.stress[n], other.stress[n], strict=True))
        res.disp[n] = tuple(a - b for a, b in zip(res.disp[n], other.disp[n], strict=True))  # type: ignore[assignment]


def nozzle_end_displacement(res: Result) -> Vec:
    """Mean displacement of the nodes on the nozzle's end face, z = 560 mm."""
    on = [n for n, q in res.nodes.items() if abs(q[2] - 560.0) < ON_SURFACE]
    return tuple(sum(res.disp[n][c] for n in on) / len(on) for c in range(3))  # type: ignore[return-value]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="+", help="label=path:units (units si or mm)")
    parser.add_argument(
        "--subtract",
        action="append",
        default=[],
        help="label=path:units: a result on the same mesh to subtract from that label's file",
    )
    parser.add_argument("--json", help="write the sampled values here")
    args = parser.parse_args()

    def parse(spec: str) -> tuple[str, Result]:
        label, _, rest = spec.partition("=")
        path, _, units = rest.rpartition(":")
        result = read(Path(path), units)
        print(f"{label}: {len(result.nodes)} nodes from {path}", file=sys.stderr)
        return label, result

    labels, results = [], []
    for spec in args.files:
        label, result = parse(spec)
        labels.append(label)
        results.append(result)
    for spec in args.subtract:
        label, other = parse(spec)
        subtract(results[labels.index(label)], other)
    table: dict[str, dict[str, dict[str, float]]] = {}
    for p in POINTS:
        table[p.name] = {label: sample(r, p) for label, r in zip(labels, results, strict=True)}
    disp = {label: nozzle_end_displacement(r) for label, r in zip(labels, results, strict=True)}

    head = " | ".join(f"{label} along | {label} around | {label} von Mises" for label in labels)
    print(f"| Point | {head} |" + (" Diff. von Mises |" if len(labels) == 2 else ""))
    print("| --- " * (1 + 3 * len(labels) + (len(labels) == 2)) + "|")
    for name, row in table.items():
        cells = " | ".join(
            f"{row[k]['along']:.2f} | {row[k]['around']:.2f} | {row[k]['vonMises']:.2f}"
            for k in labels
        )
        diff = ""
        if len(labels) == 2:
            a, b = (row[k]["vonMises"] for k in labels)
            diff = f" {100 * (b / a - 1):+.1f} % |"
        print(f"| {name} | {cells} |{diff}")
    for label, d in disp.items():
        print(f"Nozzle end displacement, {label}: ({d[0]:.4f}, {d[1]:.4f}, {d[2]:.4f}) mm")
    if args.json:
        Path(args.json).write_text(
            json.dumps({"points": table, "nozzleEndDisplacement": disp}, indent=2)
        )


if __name__ == "__main__":
    main()
