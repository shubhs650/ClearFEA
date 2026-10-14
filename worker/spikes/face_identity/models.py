# SPDX-License-Identifier: AGPL-3.0-or-later
"""Build the three M1.1 spike models with Gmsh's OpenCASCADE kernel and write them as STEP.

The geometry is original to this project. Dimensions are in millimetres, which is what
OpenCASCADE writes into the STEP header by default. ``with_length_unit`` rewrites that
header entry so the same shape can be tested as if it had been drawn in metres or inches.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from pathlib import Path

import gmsh

occ = gmsh.model.occ


def block() -> None:
    """A 100 x 50 x 20 mm rectangular block: six planar faces."""
    occ.addBox(0, 0, 0, 100, 50, 20)


def flanged_pipe() -> None:
    """A 200 mm pipe (OD 60, ID 50) with a flange at each end, each with six bolt holes."""
    length, r_out, r_in = 200.0, 30.0, 25.0
    flange_r, flange_t, bolt_circle_r, bolt_r = 75.0, 15.0, 55.0, 7.0
    pipe = occ.addCylinder(0, 0, 0, 0, 0, length, r_out)
    flanges = [
        occ.addCylinder(0, 0, 0, 0, 0, flange_t, flange_r),
        occ.addCylinder(0, 0, length - flange_t, 0, 0, flange_t, flange_r),
    ]
    body, _ = occ.fuse([(3, pipe)], [(3, f) for f in flanges])
    occ.synchronize()
    # Fillet the two circular edges where the pipe meets the inner flange faces; the
    # fillets are toroidal faces, so the model has plane, cylinder and other faces.
    junctions = []
    for dim, tag in gmsh.model.getEntities(1):
        x0, y0, z0, x1, y1, z1 = gmsh.model.getBoundingBox(dim, tag)
        on_circle = abs(x1 - x0 - 2 * r_out) < 1e-6 and abs(z1 - z0) < 1e-6
        if on_circle and min(abs(z0 - flange_t), abs(z0 - (length - flange_t))) < 1e-6:
            junctions.append(tag)
    body = occ.fillet([body[0][1]], junctions, [5.0])
    bore = occ.addCylinder(0, 0, -1, 0, 0, length + 2, r_in)
    holes = []
    for z0 in (-1.0, length - flange_t - 1):
        for k in range(6):
            a = 2 * math.pi * k / 6 + math.pi / 6
            holes.append(
                occ.addCylinder(
                    bolt_circle_r * math.cos(a),
                    bolt_circle_r * math.sin(a),
                    z0,
                    0,
                    0,
                    flange_t + 2,
                    bolt_r,
                )
            )
    occ.cut(body, [(3, bore)] + [(3, h) for h in holes])


def bracket() -> None:
    """An L bracket with filleted edges, two through holes in the base and one in the web."""
    base = occ.addBox(0, 0, 0, 120, 60, 12)
    web = occ.addBox(0, 0, 0, 12, 60, 80)
    fused, _ = occ.fuse([(3, base)], [(3, web)])
    occ.synchronize()
    vol = fused[0][1]
    # Fillet the inside corner between base and web, and the four vertical outer edges.
    edges = []
    for dim, tag in gmsh.model.getEntities(1):
        x0, y0, z0, x1, y1, z1 = gmsh.model.getBoundingBox(dim, tag)
        along_y = abs(y1 - y0 - 60) < 1e-6 and abs(x1 - x0) < 1e-6 and abs(z1 - z0) < 1e-6
        inside_corner = along_y and abs(x0 - 12) < 1e-6 and abs(z0 - 12) < 1e-6
        vertical = abs(z1 - z0 - 12) < 1e-6 and abs(x1 - x0) < 1e-6 and abs(y1 - y0) < 1e-6
        outer_end = vertical and abs(x0 - 120) < 1e-6
        if inside_corner or outer_end:
            edges.append(tag)
    filleted = occ.fillet([vol], edges, [8.0])
    holes = [
        occ.addCylinder(50, 30, -1, 0, 0, 14, 6),
        occ.addCylinder(90, 30, -1, 0, 0, 14, 6),
        occ.addCylinder(-1, 30, 55, 14, 0, 0, 8),
    ]
    occ.cut(filleted, [(3, h) for h in holes])


MODELS: dict[str, Callable[[], None]] = {
    "block": block,
    "flanged_pipe": flanged_pipe,
    "bracket": bracket,
}


def write_step(name: str, path: Path) -> None:
    gmsh.model.add(name)
    MODELS[name]()
    occ.synchronize()
    gmsh.write(str(path))
    gmsh.model.remove()


_MM_UNIT = re.compile(
    r"\(\s*LENGTH_UNIT\(\)\s*NAMED_UNIT\(\*\)\s*SI_UNIT\(\.MILLI\.,\.METRE\.\)\s*\)"
)


def with_length_unit(step_text: str, unit: str) -> str:
    """Return the STEP text with its millimetre length unit replaced by ``m`` or ``in``.

    Only the unit declaration changes, not the coordinates, so a 100 mm edge becomes a
    100 m or 100 in edge. That is the point: the importer must scale by the declared unit.
    """
    matches = _MM_UNIT.findall(step_text)
    if len(matches) != 1:
        raise ValueError(f"expected one millimetre length unit, found {len(matches)}")
    if unit == "m":
        return _MM_UNIT.sub("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) )", step_text)
    if unit == "in":
        # A conversion-based unit, written the way CAD systems that export inches do.
        last = max(int(n) for n in re.findall(r"^#(\d+)\s*=", step_text, re.M))
        a, b, c = last + 1, last + 2, last + 3
        new = f"( CONVERSION_BASED_UNIT('INCH',#{a}) LENGTH_UNIT() NAMED_UNIT(#{c}) )"
        extra = (
            f"#{a} = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#{b});\n"
            f"#{b} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n"
            f"#{c} = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
        )
        out = _MM_UNIT.sub(new, step_text)
        return out.replace("ENDSEC;\nEND-ISO-10303-21;", extra + "ENDSEC;\nEND-ISO-10303-21;")
    raise ValueError(f"unsupported unit {unit!r}")
