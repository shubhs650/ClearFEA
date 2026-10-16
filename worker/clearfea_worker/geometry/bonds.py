# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bond detection: faces of different bodies that touch over an area (M4.2, ADR-059).

Bodies of an assembly are imported apart (ADR-058), so two parts that touch have two faces on
the same patch of space. A pair of faces is a candidate bond when, over at least
``MIN_AREA_FRACTION`` of the smaller face, the faces lie within the tolerance of each other.

The area is measured on the display tessellation: a triangle counts when its vertices and its
centroid (moved onto its own face, so a curved face is sampled on the surface, not on the chord)
are all within the tolerance of the other face's surface and the centroid lands inside the other
face's trimmed boundary. Both faces are sampled and the
larger area kept, so a small face on a large one is found even when the large face's triangles
are bigger than the small face. Faces that meet only along an edge, a line or at a point
have no triangle wholly within the tolerance and are not bonds.
"""

import math
from collections.abc import Sequence
from types import ModuleType

from ..spec.geometry_schema import TopologyBond, TopologyFace
from .display import FacePatch

#: The bond tolerance as a fraction of the model's bounding box diagonal: 0.03 mm on a 300 mm
#: model, well above the 1e-7 m to which CAD systems place mated faces, well below any
#: clearance modelled on purpose.
BOND_TOLERANCE_FRACTION = 1e-4
#: A pair touching over less than this fraction of the smaller face is a line or point contact
#: (a cylinder lying on a plane), not a bond.
MIN_AREA_FRACTION = 0.01


def bond_tolerance(size: float) -> float:
    """The bond tolerance in metres for a model whose bounding box diagonal is ``size``."""
    return size * BOND_TOLERANCE_FRACTION


def boxes_meet(a: Sequence[float], b: Sequence[float], tolerance: float) -> bool:
    """True when two boxes (xmin, ymin, zmin, xmax, ymax, zmax) are within ``tolerance``."""
    return all(a[i] <= b[i + 3] + tolerance and b[i] <= a[i + 3] + tolerance for i in range(3))


def candidate_pairs(faces: Sequence[TopologyFace], tolerance: float) -> list[tuple[int, int]]:
    """Pairs of faces of different bodies whose boxes are within ``tolerance``, smaller tag first.

    A face of two bodies (a shared face of a fused model) already joins them and is left out.
    """
    single = sorted((f for f in faces if len(f.bodies) == 1), key=lambda f: f.tag)
    pairs = []
    for i, a in enumerate(single):
        for b in single[i + 1 :]:
            if a.bodies[0] != b.bodies[0] and boxes_meet(a.bbox, b.bbox, tolerance):
                pairs.append((a.tag, b.tag))
    return pairs


def triangle_areas(patch: FacePatch) -> list[float]:
    """Area of each triangle of a face's tessellation."""
    p = patch.positions
    t = patch.triangles
    areas = []
    for k in range(0, len(t), 3):
        a, b, c = (p[3 * t[k + j] : 3 * t[k + j] + 3] for j in range(3))
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        cross = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        areas.append(0.5 * math.hypot(*cross))
    return areas


def triangle_centroids(patch: FacePatch) -> list[float]:
    """x, y, z of each triangle's centroid in turn (on the chord, not yet on the face)."""
    p = patch.positions
    t = patch.triangles
    centroids: list[float] = []
    for k in range(0, len(t), 3):
        for i in range(3):
            centroids.append(sum(p[3 * t[k + j] + i] for j in range(3)) / 3)
    return centroids


def _distances(gmsh: ModuleType, face: int, points: list[float]) -> tuple[list[float], list[float]]:
    """Distance of each point to the (untrimmed) surface of ``face``, and the projected points."""
    if not points:
        return [], []
    projected, _ = gmsh.model.getClosestPoint(2, face, points)
    projected = [float(c) for c in projected]
    return [
        math.dist(points[3 * k : 3 * k + 3], projected[3 * k : 3 * k + 3])
        for k in range(len(points) // 3)
    ], projected


def _contact(
    gmsh: ModuleType, face: int, other: int, patch: FacePatch, area: float, tolerance: float
) -> tuple[float, float]:
    """Area of ``face`` within ``tolerance`` of ``other`` and the largest distance over it.

    A triangle counts when its three vertices (which lie on the face) and its centroid (moved
    onto the face) are all within the tolerance of the other face's surface, and the centroid
    lands inside the other face's boundary. Requiring every vertex keeps out triangles that only
    cross the other face along a line, as at an edge or a line contact.
    """
    areas = triangle_areas(patch)
    total = sum(areas)
    if total <= 0:
        return 0.0, 0.0
    near, _ = _distances(gmsh, other, [float(c) for c in patch.positions])
    on_face, _ = gmsh.model.getClosestPoint(2, face, triangle_centroids(patch))
    middle, landed = _distances(gmsh, other, [float(c) for c in on_face])
    t = patch.triangles
    touching = 0.0
    gap = 0.0
    for k, weight in enumerate(areas):
        corners = [near[t[3 * k + j]] for j in range(3)]
        worst = max(*corners, middle[k])
        if worst <= tolerance and gmsh.model.isInside(2, other, landed[3 * k : 3 * k + 3]):
            touching += weight
            gap = max(gap, worst)
    # Scale from the flat triangles to the face's own area.
    return touching * area / total, gap


def detect_bonds(
    gmsh: ModuleType,
    faces: Sequence[TopologyFace],
    patches: Sequence[FacePatch],
    tolerance: float,
) -> list[TopologyBond]:
    """Candidate bonds of the model in the Gmsh session, sorted by face tags.

    ``faces`` are the topology's faces and ``patches`` their display tessellation.
    """
    by_tag = {f.tag: f for f in faces}
    patch = {p.tag: p for p in patches}

    bonds = []
    for a, b in candidate_pairs(faces, tolerance):
        if gmsh.model.occ.getDistance(2, a, 2, b)[0] > tolerance:
            continue
        fa, fb = by_tag[a], by_tag[b]
        area_ab, gap_ab = _contact(gmsh, a, b, patch[a], fa.area, tolerance)
        area_ba, gap_ba = _contact(gmsh, b, a, patch[b], fb.area, tolerance)
        # The larger sample, never more than the smaller face (chords make a curved face's
        # triangles a little smaller than the face).
        area = min(max(area_ab, area_ba), fa.area, fb.area)
        if area <= 0 or area < MIN_AREA_FRACTION * min(fa.area, fb.area):
            continue
        bonds.append(
            TopologyBond(
                faces=[a, b],
                bodies=[fa.bodies[0], fb.bodies[0]],
                area=area,
                gap=max(gap_ab, gap_ba),
            )
        )
    return bonds
