# SPDX-License-Identifier: AGPL-3.0-or-later
"""V-23 geometry: NAFEMS LE10, a quarter of a thick elliptic plate with an elliptic hole,
written as a STEP file in millimetres.

    uv run --directory worker python ../verification/cases/V-23-thick-plate/geometry.py OUT.step

The plate lies between the ellipses (x/2000)² + (y/1000)² = 1 (the hole) and
(x/3250)² + (y/2750)² = 1 (the outside), in the quarter x ≥ 0, y ≥ 0, and from z = -300 to
z = 300 mm. It is made as two layers fused together, so that its faces are split at the
mid-plane z = 0: the outside face's mid-plane line (EE' in the benchmark) is then an edge of
its own, which the case holds in z (a support on an edge, ADR-105).
"""

import sys

import gmsh

HOLE = (2000.0, 1000.0)
OUTSIDE = (3250.0, 2750.0)
HALF = 300.0  # half the thickness


def _layer(occ, z: float) -> int:  # type: ignore[no-untyped-def]
    outside = occ.addDisk(0, 0, z, *OUTSIDE)
    hole = occ.addDisk(0, 0, z, *HOLE)
    ring, _ = occ.cut([(2, outside)], [(2, hole)])
    quarter = occ.addRectangle(0, 0, z, OUTSIDE[0] + 10, OUTSIDE[1] + 10)
    piece, _ = occ.intersect(ring, [(2, quarter)])
    solid = occ.extrude(piece, 0, 0, HALF)
    return next(tag for dim, tag in solid if dim == 3)


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        lower = _layer(occ, -HALF)
        upper = _layer(occ, 0.0)
        occ.fuse([(3, lower)], [(3, upper)])
        occ.synchronize()
        gmsh.write(path)
    finally:
        gmsh.finalize()


if __name__ == "__main__":
    main(sys.argv[1])
