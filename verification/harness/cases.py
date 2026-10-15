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
    face: str
    box: Box | None
    reference: float  # SI
    unit: str  # the reference's unit as entered, used for the table
    tolerance: dict[str, float]  # tier -> relative tolerance


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


#: Quantity a check can compare -> its units.json kind. Radial is about the z axis.
QUANTITIES = {
    "vonMises": "pressure",
    "displacement": "length",
    "displacement.x": "length",
    "displacement.y": "length",
    "displacement.z": "length",
    "displacement.radial": "length",
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
        if item["face"] not in faces:
            raise CaseError(f"{folder.name}: check {item['name']!r} names an unknown face.")
        ref = item["reference"]
        tolerance = {tier: float(item["tolerance"][tier]) for tier in TIERS}
        checks.append(
            Check(
                name=item["name"],
                quantity=quantity,
                face=item["face"],
                box=_box(item["box"], unit, item["name"]) if "box" in item else None,
                reference=to_si(float(ref["value"]), ref["unit"], QUANTITIES[quantity]),
                unit=ref["unit"],
                tolerance=tolerance,
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


def applied_load(spec: dict[str, Any], surface: Surface) -> tuple[list[float], float]:
    """Total force of the spec's pressures on the run's surface, and the sum of their sizes.

    A positive pressure pushes into the body (ADR-026), against the outward normal, which
    surface.bin's triangles follow. Values in newtons.
    """
    magnitude = {}
    for load in spec["loads"]:
        value = to_si(load["magnitude"]["value"], load["magnitude"]["unit"], "pressure")
        for tag in load["faces"]:
            magnitude[tag] = magnitude.get(tag, 0.0) + value
    total, gross = [0.0, 0.0, 0.0], 0.0
    for patch in surface.patches:
        p = magnitude.get(patch.tag)
        if p is None:
            continue
        for a, b, c in patch.triangles:
            pa, pb, pc = surface.positions[a], surface.positions[b], surface.positions[c]
            ab = [pb[i] - pa[i] for i in range(3)]
            ac = [pc[i] - pa[i] for i in range(3)]
            n2 = [  # twice the area times the outward normal
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ]
            for i in range(3):
                total[i] -= p * n2[i] / 2
            gross += abs(p) * math.sqrt(sum(x * x for x in n2)) / 2
    return total, gross


def unexpected_warnings(log: str, allowed: list[re.Pattern[str]]) -> list[str]:
    """Solver log lines that warn and that the case does not expect."""
    return [
        line.strip()
        for line in log.splitlines()
        if "warning" in line.lower() and not any(p.search(line) for p in allowed)
    ]
