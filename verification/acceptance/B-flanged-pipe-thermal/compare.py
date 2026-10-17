# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reads case B's temperatures and stresses from CalculiX result files and compares them.

    cd worker
    uv run python ../verification/acceptance/B-flanged-pipe-thermal/compare.py \\
        clearfea=results.frd:si freecad=Mesh.frd:mm [--hand through_wall.json] [--json OUT]

Each argument is ``label=path:units``: ``si`` for a file in metres and pascals (ClearFEA's raw
output), ``mm`` for one in millimetres and megapascals (FreeCAD's); temperatures are kelvin in
both. With two files the table gives the second's difference from the first, and ``--hand``
adds through_wall.py's values to the far-field rows.

Far field: every node with 30 ≤ z ≤ 90 mm, where the wall is a long cylinder (the flange is
250 mm and more away, over three decay lengths), with stresses in cylindrical components
(r, θ, z). At the bore and the outside a value is the mean over the surface's nodes; inside the
wall it is a least-squares quadratic in r through the nodes within 4 mm of the radius.

Flange: points on the surface near the flange, each the inverse-distance mean of the surface
nodes within 8 mm (no fit), in the same components. The largest von Mises stress anywhere is
listed too; it sits in the sharp corner where the flange's back meets the pipe, so it depends
on the mesh and is not compared.
"""

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from clearfea_worker.results.frd import read_nodal_blocks

ON = 0.05  # mm: a node this close to a surface is on it
A, B = 100.0, 150.0
FAR = (30.0, 90.0)
RADII = (100.0, 112.5, 125.0, 137.5, 150.0)
KELVIN = 273.15

#: Points near the flange: (name, (r, θ in degrees, z) in mm, the surface: "r=<radius>" or "z=<z>").
FLANGE_POINTS = [
    ("Bore at the flange, z = 370", (100.0, 45.0, 370.0), "r=100"),
    ("Bore at the end, z = 400", (100.0, 45.0, 400.0), "z=400"),
    ("Pipe outside, z = 250", (150.0, 45.0, 250.0), "r=150"),
    ("Pipe outside, z = 320", (150.0, 45.0, 320.0), "r=150"),
    ("Flange back, r = 190", (190.0, 45.0, 340.0), "z=340"),
    ("Flange rim, z = 370", (230.0, 45.0, 370.0), "r=230"),
    ("Flange end face, r = 165", (165.0, 45.0, 400.0), "z=400"),
]


@dataclass
class Result:
    nodes: dict[int, tuple[float, float, float]]  # mm
    stress: dict[int, tuple[float, ...]]  # MPa: xx, yy, zz, xy, yz, zx
    temp: dict[int, float]  # °C


def read(path: Path, units: str) -> Result:
    length, stress = {"si": (1e3, 1e-6), "mm": (1.0, 1.0)}[units]
    nodes: dict[int, tuple[float, float, float]] = {}
    with path.open(encoding="ascii", errors="replace") as f:
        width = None
        for line in f:
            if line.startswith("    2C"):
                width = 10 if line[73:75].strip() == "1" else 5
            elif width is not None and line.startswith(" -1"):
                n = int(line[3 : 3 + width])
                v = line[3 + width :].rstrip("\n")
                nodes[n] = tuple(float(v[k : k + 12]) * length for k in range(0, 36, 12))  # type: ignore[assignment]
            elif width is not None and line.startswith(" -3"):
                break
    blocks = read_nodal_blocks(path, max(nodes), {"STRESS", "NDTEMP"})
    sv, ns = blocks["STRESS"].values, len(blocks["STRESS"].components)
    tv, nt = blocks["NDTEMP"].values, len(blocks["NDTEMP"].components)
    return Result(
        nodes=nodes,
        stress={n: tuple(sv[(n - 1) * ns + c] * stress for c in range(6)) for n in nodes},
        temp={n: tv[(n - 1) * nt] - KELVIN for n in nodes},
    )


def cylindrical(s: tuple[float, ...], x: float, y: float) -> tuple[float, float, float]:
    """σr, σθ, σz at a point at (x, y)."""
    xx, yy, zz, xy, _, _ = s
    t = math.atan2(y, x)
    c, si = math.cos(t), math.sin(t)
    sr = xx * c * c + yy * si * si + 2 * xy * c * si
    st = xx * si * si + yy * c * c - 2 * xy * c * si
    return sr, st, zz


def mises(s: tuple[float, ...]) -> float:
    xx, yy, zz, xy, yz, zx = s
    return math.sqrt(
        0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy**2 + yz**2 + zx**2)
    )


def _values(res: Result, n: int) -> list[float]:
    x, y, _ = res.nodes[n]
    return [res.temp[n], *cylindrical(res.stress[n], x, y), mises(res.stress[n])]


NAMES = ("T", "r", "theta", "z", "vonMises")


def _quadratic_fit(points: list[tuple[float, list[float]]], r0: float) -> list[float]:
    """Each value's least-squares quadratic in (r − r0), read at r0."""
    out = []
    for k in range(len(NAMES)):
        # normal equations for a + b d + c d²
        s = [[0.0] * 3 for _ in range(3)]
        t = [0.0] * 3
        for r, vals in points:
            d = r - r0
            basis = (1.0, d, d * d)
            for i in range(3):
                t[i] += basis[i] * vals[k]
                for j in range(3):
                    s[i][j] += basis[i] * basis[j]
        out.append(_solve3(s, t)[0])
    return out


def _solve3(m: list[list[float]], v: list[float]) -> list[float]:
    a = [row[:] + [v[i]] for i, row in enumerate(m)]
    for i in range(3):
        p = max(range(i, 3), key=lambda r: abs(a[r][i]))
        a[i], a[p] = a[p], a[i]
        for r in range(3):
            if r != i:
                f = a[r][i] / a[i][i]
                a[r] = [x - f * y for x, y in zip(a[r], a[i], strict=True)]
    return [a[i][3] / a[i][i] for i in range(3)]


def far_field(res: Result) -> dict[str, dict[str, float]]:
    band = [n for n, (x, y, z) in res.nodes.items() if FAR[0] <= z <= FAR[1]]
    out = {}
    for r0 in RADII:
        if r0 in (A, B):
            on = [n for n in band if abs(math.hypot(*res.nodes[n][:2]) - r0) < ON]
            vals = [sum(_values(res, n)[k] for n in on) / len(on) for k in range(len(NAMES))]
        else:
            pts = [(math.hypot(*res.nodes[n][:2]), _values(res, n)) for n in band]
            pts = [(r, v) for r, v in pts if abs(r - r0) < 4.0]
            vals = _quadratic_fit(pts, r0)
        out[f"r = {r0:g}"] = dict(zip(NAMES, vals, strict=True))
    return out


def on_surface(q: tuple[float, float, float], surface: str) -> bool:
    kind, value = surface.split("=")
    v = float(value)
    return abs(math.hypot(q[0], q[1]) - v) < ON if kind == "r" else abs(q[2] - v) < ON


def flange(res: Result) -> dict[str, dict[str, float]]:
    out = {}
    for name, (r, theta, z), surface in FLANGE_POINTS:
        t = math.radians(theta)
        at = (r * math.cos(t), r * math.sin(t), z)
        near = [
            (math.dist(q, at), n)
            for n, q in res.nodes.items()
            if on_surface(q, surface) and math.dist(q, at) < 8.0
        ]
        if not near:
            raise ValueError(f"no node within 8 mm of {name}")
        w = [(1 / max(d, 1e-6) ** 2, n) for d, n in near]
        total = sum(x for x, _ in w)
        vals = [sum(x * _values(res, n)[k] for x, n in w) / total for k in range(len(NAMES))]
        out[name] = dict(zip(NAMES, vals, strict=True))
    peak = max(res.nodes, key=lambda n: mises(res.stress[n]))
    out["Largest von Mises (corner, not compared)"] = dict(
        zip(NAMES, _values(res, peak), strict=True)
    )
    out["Largest von Mises (corner, not compared)"]["at"] = list(res.nodes[peak])  # type: ignore[assignment]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="+", help="label=path:units (units si or mm)")
    parser.add_argument("--hand", help="through_wall.py --json output")
    parser.add_argument("--json", help="write the sampled values here")
    args = parser.parse_args()
    labels, results = [], []
    for spec in args.files:
        label, _, rest = spec.partition("=")
        path, _, units = rest.rpartition(":")
        res = read(Path(path), units)
        print(f"{label}: {len(res.nodes)} nodes from {path}", file=sys.stderr)
        labels.append(label)
        results.append(res)
    hand = {}
    if args.hand:
        data = json.loads(Path(args.hand).read_text())
        for p in data["points"]:
            v = p["varying_E_MPa"]
            hand[f"r = {p['r_mm']:g}"] = {
                "T": p["T"],
                "r": v["r"],
                "theta": v["theta"],
                "z": v["z"],
                "vonMises": v["von_mises"],
            }
    table = {"far": {}, "flange": {}}
    ff = [far_field(r) for r in results]
    fl = [flange(r) for r in results]
    for key in ff[0]:
        table["far"][key] = {label: f[key] for label, f in zip(labels, ff, strict=True)}
        if key in hand:
            table["far"][key]["hand"] = hand[key]
    for key in fl[0]:
        table["flange"][key] = {label: f[key] for label, f in zip(labels, fl, strict=True)}

    def show(section: str, cols: list[str]) -> None:
        print(f"\n{section}: T (°C), σr, σθ, σz, von Mises (MPa)")
        for key, row in table[section].items():
            cells = []
            for c in cols:
                if c in row:
                    cells.append(f"{c}: " + " ".join(f"{row[c][k]:8.2f}" for k in NAMES))
            line = f"{key:45s} | " + " | ".join(cells)
            base = cols[0] if cols[0] in row else None
            if base and len(cols) > 1 and cols[1] in row:
                a, b = row[base], row[cols[1]]
                dvm = 100 * (b["vonMises"] / a["vonMises"] - 1)
                line += f" | ΔT {b['T'] - a['T']:+.2f} K, Δσθ {b['theta'] - a['theta']:+.2f}"
                line += f", ΔVM {dvm:+.1f} %"
            print(line)

    cols = (["hand"] if hand else []) + labels
    show("far", cols)
    show("flange", labels)
    if args.json:
        Path(args.json).write_text(json.dumps(table, indent=1))


if __name__ == "__main__":
    main()
