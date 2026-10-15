# SPDX-License-Identifier: AGPL-3.0-or-later
"""Verification cases: reading a case folder, naming its faces, and evaluating its checks.

Pure functions only; `verify.py` does the talking to the API. The case layout is described
in docs/VERIFICATION.md and verification/README.md.
"""

import copy
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from clearfea_worker.units import to_si

from .binfiles import Surface

TIERS = ("coarse", "full")
#: Reactions must balance the applied loads to this fraction of the total applied load.
BALANCE_TOLERANCE = 1e-3
#: Slack on box bounds, in metres, so that a vertex on a bound is inside. The viewer files
#: hold float32 positions, which can be off by a few 1e-8 m on a model a few metres in size.
BOX_SLACK = 1e-6
#: A face's bounding box matches a case's face box to this many units of the geometry.
FACE_MATCH = 0.01


class CaseError(ValueError):
    """A case folder or its setup is wrong. The message says what to fix."""


@dataclass(frozen=True)
class Box:
    """An axis-aligned box in metres."""

    lo: tuple[float, float, float]
    hi: tuple[float, float, float]

    def holds(self, p: tuple[float, float, float], slack: float = BOX_SLACK) -> bool:
        return all(self.lo[i] - slack <= p[i] <= self.hi[i] + slack for i in range(3))


@dataclass(frozen=True)
class Check:
    name: str
    quantity: str
    face: str | None  # None for a reaction check
    box: Box | None
    reference: float  # SI
    unit: str  # the reference's unit as entered, used for the table
    tolerance: dict[str, float]  # tier -> relative tolerance
    support: str | None = None  # the spec support id of a reaction check


@dataclass(frozen=True)
class Case:
    id: str
    title: str
    folder: Path
    unit: str  # the geometry's length unit, confirmed after upload
    faces: dict[str, Box]
    mesh: dict[str, dict[str, Any]]  # tier -> {value, unit}
    checks: list[Check]
    allowed_warnings: list[re.Pattern[str]]
    spec: dict[str, Any]  # spec.json, faces by name


#: Quantity a check can compare -> its units.json kind. Radial is about the z axis. A reaction
#: is a component of one support's total reaction in the run's result (M2.2).
QUANTITIES = {
    "vonMises": "pressure",
    "displacement": "length",
    "displacement.x": "length",
    "displacement.y": "length",
    "displacement.z": "length",
    "displacement.radial": "length",
    "reaction.x": "force",
    "reaction.y": "force",
    "reaction.z": "force",
}


def _box(raw: Any, unit: str, where: str) -> Box:
    try:
        lo = tuple(to_si(float(v), unit, "length") for v in raw["min"])
        hi = tuple(to_si(float(v), unit, "length") for v in raw["max"])
    except (KeyError, TypeError, ValueError) as error:
        raise CaseError(f"{where}: give min and max as three numbers each ({error}).") from None
    if len(lo) != 3 or len(hi) != 3 or any(lo[i] > hi[i] for i in range(3)):
        raise CaseError(f"{where}: min and max must be three numbers each, min not above max.")
    return Box(lo, hi)  # type: ignore[arg-type]


def load_case(folder: Path) -> Case:
    raw = yaml.safe_load((folder / "case.yaml").read_text())
    spec = json.loads((folder / "spec.json").read_text())
    unit = raw["geometry"]["unit"]
    faces = {
        name: _box(box, unit, f"{folder.name} face {name}") for name, box in raw["faces"].items()
    }
    for tier in TIERS:
        if tier not in raw["mesh"]:
            raise CaseError(f"{folder.name}: case.yaml has no mesh size for the {tier} tier.")
    checks = []
    for item in raw["checks"]:
        quantity = item["quantity"]
        if quantity not in QUANTITIES:
            raise CaseError(
                f"{folder.name}: unknown quantity {quantity}; use one of {list(QUANTITIES)}."
            )
        support = None
        if quantity.startswith("reaction."):
            support = item.get("support")
            if support not in {s["id"] for s in spec["supports"]}:
                raise CaseError(
                    f"{folder.name}: check {item['name']!r} must name a support id of spec.json."
                )
        elif item.get("face") not in faces:
            raise CaseError(f"{folder.name}: check {item['name']!r} names an unknown face.")
        ref = item["reference"]
        tolerance = {tier: float(item["tolerance"][tier]) for tier in TIERS}
        checks.append(
            Check(
                name=item["name"],
                quantity=quantity,
                face=item.get("face"),
                box=_box(item["box"], unit, item["name"]) if "box" in item else None,
                reference=to_si(float(ref["value"]), ref["unit"], QUANTITIES[quantity]),
                unit=ref["unit"],
                tolerance=tolerance,
                support=support,
            )
        )
    allowed = [re.compile(p) for p in raw.get("allowedWarnings", [])]
    return Case(raw["id"], raw["title"], folder, unit, faces, raw["mesh"], checks, allowed, spec)


def name_faces(case: Case, topology: dict[str, Any]) -> dict[str, int]:
    """Face name -> tag: the one face of topology.json whose bounding box is the name's box.

    Bounds match to FACE_MATCH of the geometry's unit, which allows for OpenCASCADE's
    slightly enlarged boxes.
    """
    slack = to_si(FACE_MATCH, case.unit, "length")
    tags = {}
    for name, box in case.faces.items():
        found = [
            face["tag"]
            for face in topology["faces"]
            if all(abs(face["bbox"][i] - box.lo[i]) <= slack for i in range(3))
            and all(abs(face["bbox"][3 + i] - box.hi[i]) <= slack for i in range(3))
        ]
        if len(found) != 1:
            raise CaseError(
                f"{case.id}: face {name!r} should match exactly one face of the geometry, "
                f"found tags {found}. Check its box in case.yaml."
            )
        tags[name] = found[0]
    return tags


def build_spec(case: Case, tags: dict[str, int], geometry_id: str, tier: str) -> dict[str, Any]:
    """spec.json with face names turned into tags, the geometry id and the tier's mesh size."""
    spec = copy.deepcopy(case.spec)
    spec["geometryId"] = geometry_id
    for item in spec["supports"] + spec["loads"]:
        if "faces" not in item:  # gravity and centrifugal loads act on every body
            continue
        unknown = [f for f in item["faces"] if f not in tags]
        if unknown:
            raise CaseError(
                f"{case.id}: spec.json item {item['id']} names unknown faces {unknown}."
            )
        item["faces"] = [tags[f] for f in item["faces"]]
    spec["mesh"] = {"size": dict(case.mesh[tier])}
    return spec


def _value(quantity: str, p: tuple[float, ...], u: tuple[float, ...], mises: float) -> float:
    if quantity == "vonMises":
        return mises
    if quantity == "displacement":
        return math.sqrt(sum(c * c for c in u))
    if quantity == "displacement.radial":
        r = math.hypot(p[0], p[1])
        return (u[0] * p[0] + u[1] * p[1]) / r
    return u["xyz".index(quantity[-1])]


def evaluate(
    check: Check, surface: Surface, fields: dict[str, list[tuple[float, ...]]], tags: dict[str, int]
) -> tuple[float, int]:
    """Mean of the check's quantity over the surface vertices of its face inside its box."""
    assert check.face is not None
    tag = tags[check.face]
    values = []
    for patch in surface.patches:
        if patch.tag != tag:
            continue
        for v in range(patch.first_vertex, patch.first_vertex + patch.vertex_count):
            p = surface.positions[v]
            if check.box is None or check.box.holds(p):
                values.append(
                    _value(check.quantity, p, fields["displacement"][v], fields["vonMises"][v][0])
                )
    if not values:
        raise CaseError(
            f"No surface vertex of face {check.face} lies in the box of {check.name!r}."
        )
    return sum(values) / len(values), len(values)


def reaction(check: Check, reactions: list[dict[str, Any]]) -> float:
    """The component a reaction check names of its support's total reaction, in newtons."""
    [force] = [r["force"] for r in reactions if r["supportId"] == check.support]
    return float(force["xyz".index(check.quantity[-1])])


def balance(load: list[float], gross: float, reactions: list[list[float]]) -> tuple[float, float]:
    """How far the reactions are from balancing the applied load, and the size it is measured
    against: the sum of the applied loads' sizes, or with no load (a prescribed displacement,
    M2.2) the sum of the reactions' sizes, which must then balance each other."""
    total = [sum(r[i] for r in reactions) for i in range(3)]
    if gross == 0.0:
        gross = sum(math.sqrt(sum(c * c for c in r)) for r in reactions)
    return math.dist(total, [-c for c in load]), gross


def _triangles(surface: Surface):  # type: ignore[no-untyped-def]
    for patch in surface.patches:
        for a, b, c in patch.triangles:
            yield patch.tag, surface.positions[a], surface.positions[b], surface.positions[c]


def _cross(u: Any, v: Any) -> list[float]:
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]


def volume_and_moment(surface: Surface) -> tuple[float, list[float]]:
    """Volume (m³) and first moment of volume (m⁴) enclosed by the run's surface.

    The surface is closed and its triangles face outwards, so the volume is the sum of the
    signed tetrahedra each triangle makes with the origin, and the first moment the sum of
    each tetrahedron's volume times its centroid (divergence theorem).
    """
    volume, moment = 0.0, [0.0, 0.0, 0.0]
    for _, a, b, c in _triangles(surface):
        v = sum(a[i] * x for i, x in enumerate(_cross(b, c))) / 6
        volume += v
        for i in range(3):
            moment[i] += v * (a[i] + b[i] + c[i]) / 4
    return volume, moment


def _axial_frame(point: list[float], axis: list[float]):  # type: ignore[no-untyped-def]
    """Coordinates (s, t) at right angles to the unit ``axis`` through ``point``."""
    helper = [1.0, 0.0, 0.0] if abs(axis[0]) < 0.9 else [0.0, 1.0, 0.0]
    e1 = _cross(axis, helper)
    n1 = math.sqrt(sum(x * x for x in e1))
    e1 = [x / n1 for x in e1]
    e2 = _cross(axis, e1)

    def local(p: Any) -> tuple[float, float]:
        d = [p[i] - point[i] for i in range(3)]
        return sum(d[i] * e1[i] for i in range(3)), sum(d[i] * e2[i] for i in range(3))

    return local


def distance_integral(surface: Surface, point: list[float], axis: list[float]) -> float:
    """The integral over the enclosed volume of the distance from the axis (m⁴).

    With (s, t) at right angles to the axis and r = sqrt(s² + t²), the field (s r, t r, 0) / 3
    has divergence r, so the integral is its flux through the surface, taken with the
    three-point edge-midpoint rule on each triangle.
    """
    local = _axial_frame(point, axis)
    total = 0.0
    for _, a, b, c in _triangles(surface):
        n2 = _cross([b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)])
        # The flux of (s r, t r) / 3 through a triangle: its normal in the (s, t) plane.
        ns, nt = local([a[i] + n2[i] for i in range(3)])
        ns0, nt0 = local(a)
        ns, nt = ns - ns0, nt - nt0
        for p, q in ((a, b), (b, c), (c, a)):
            s_, t_ = local([(p[i] + q[i]) / 2 for i in range(3)])
            r = math.hypot(s_, t_)
            total += (s_ * r * ns + t_ * r * nt) / 3 / 2 / 3
    return total


def applied_load(spec: dict[str, Any], surface: Surface) -> tuple[list[float], float]:
    """Total applied force of the spec on the run's surface, and the sum of the loads' sizes.

    A positive pressure pushes into the body (ADR-026), against the outward normal, which
    surface.bin's triangles follow. A force adds its components, and so does a remote load's
    force (its moment adds no force). Gravity and a centrifugal
    load act on the volume the surface encloses, with the density of the (single) material.
    Values in newtons.
    """
    magnitude: dict[int, float] = {}
    total, gross = [0.0, 0.0, 0.0], 0.0
    gravity = [0.0, 0.0, 0.0]
    spins = []
    for load in spec["loads"]:
        if load["type"] == "pressure":
            value = to_si(load["magnitude"]["value"], load["magnitude"]["unit"], "pressure")
            for tag in load["faces"]:
                magnitude[tag] = magnitude.get(tag, 0.0) + value
        elif load["type"] in ("force", "remote"):
            given = load if load["type"] == "force" else load["force"]
            f = [to_si(given[a]["value"], given[a]["unit"], "force") for a in "xyz"]
            for i in range(3):
                total[i] += f[i]
            gross += math.sqrt(sum(x * x for x in f))
        elif load["type"] == "gravity":
            g = [to_si(load[a]["value"], load[a]["unit"], "acceleration") for a in "xyz"]
            for i in range(3):
                gravity[i] += g[i]
        else:
            spins.append(load)
    for tag, a, b, c in _triangles(surface):
        p = magnitude.get(tag)
        if p is None:
            continue
        n2 = _cross([b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)])
        for i in range(3):
            total[i] -= p * n2[i] / 2
        gross += abs(p) * math.sqrt(sum(x * x for x in n2)) / 2
    if any(gravity) or spins:
        densities = {
            json.dumps(m.get("density"), sort_keys=True)
            for m in spec["materials"]
            if any(b["material"] == m["id"] for b in spec["bodies"])
        }
        if len(densities) != 1:
            raise CaseError("Body loads in the harness need every body made of one material.")
        density = json.loads(densities.pop())
        rho = to_si(density["value"], density["unit"], "density")
        volume, moment = volume_and_moment(surface)
        for i in range(3):
            total[i] += rho * volume * gravity[i]
        gross += rho * volume * math.sqrt(sum(x * x for x in gravity))
        for load in spins:
            w = load["angularVelocity"]
            omega = to_si(w["value"], w["unit"], "angularVelocity")
            point = [
                to_si(load["axisPoint"][a]["value"], load["axisPoint"][a]["unit"], "length")
                for a in "xyz"
            ]
            d = [float(load["axisDirection"][a]) for a in "xyz"]
            n = math.sqrt(sum(x * x for x in d))
            axis = [x / n for x in d]
            # rho w² times the integral of the distance vector from the axis.
            arm = [moment[i] - volume * point[i] for i in range(3)]
            along = sum(arm[i] * axis[i] for i in range(3))
            for i in range(3):
                total[i] += rho * omega**2 * (arm[i] - along * axis[i])
            gross += rho * omega**2 * distance_integral(surface, point, axis)
    return total, gross


def unexpected_warnings(log: str, allowed: list[re.Pattern[str]]) -> list[str]:
    """Solver log lines that warn and that the case does not expect."""
    return [
        line.strip()
        for line in log.splitlines()
        if "warning" in line.lower() and not any(p.search(line) for p in allowed)
    ]
