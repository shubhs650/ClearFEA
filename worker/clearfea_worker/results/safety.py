# SPDX-License-Identifier: AGPL-3.0-or-later
"""Safety factor against yield at every node (M3.5, ADR-054). Physics-critical.

The safety factor of a node is the tensile yield strength of its material over the node's von
Mises stress: the von Mises (distortion energy) yield criterion for a ductile isotropic metal,
the same equivalent stress the viewer shows. It is a number only, never a verdict (CLAUDE.md).

A node shared by bodies of different materials takes the smallest of their yield strengths.
Where the von Mises stress is zero, or the factor would exceed ``CAP``, the value is ``CAP``:
the field's colours and legend need finite values, and a factor that large says only that the
material is far from yield there.
"""

import math
from array import array

from ..meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ..spec.simulation_schema import SimulationSpec
from ..units import to_si
from .fields import NodalFields, von_mises_field

#: The largest safety factor kept; larger values, and nodes without stress, read as this.
CAP = 15.0


def yield_strengths(spec: SimulationSpec) -> dict[int, float] | None:
    """Yield strength in pascals of each body's material, by body tag; None when a body's
    material has no yield strength, since a factor for part of the model would read as one for
    all of it."""
    materials = {m.id: m for m in spec.materials}
    out: dict[int, float] = {}
    for body in spec.bodies:
        material = materials.get(body.material) if body.material is not None else None
        strength = material.yield_strength if material is not None else None
        if strength is None:
            return None
        out[body.tag] = to_si(strength.value, strength.unit, "pressure")
    return out


def node_yield_strengths(mesh: VolumeMesh, strengths: dict[int, float]) -> array:
    """``out[n]``: the smallest yield strength (Pa) of the bodies whose elements use node n."""
    per = NODES_PER_ELEMENT[mesh.order]
    out = array("d", [math.inf]) * mesh.node_count
    for tag, (first, count) in mesh.bodies.items():
        strength = strengths[tag]
        for node in mesh.elements[first * per : (first + count) * per]:
            if strength < out[node]:
                out[node] = strength
    if any(math.isinf(v) for v in out):
        raise ValueError("A node of the mesh belongs to no body, so it has no material.")
    return out


def safety_factor(strength: float, mises: float) -> float:
    """``strength / mises``, at most CAP; CAP where there is no stress."""
    if mises * CAP <= strength:
        return CAP
    return strength / mises


def safety_factor_field(
    spec: SimulationSpec, mesh: VolumeMesh, fields: NodalFields
) -> array | None:
    """The safety factor against yield of every node, or None when a material of the setup has
    no yield strength."""
    strengths = yield_strengths(spec)
    if strengths is None:
        return None
    node_strength = node_yield_strengths(mesh, strengths)
    mises = von_mises_field(fields)
    return array("d", (safety_factor(s, m) for s, m in zip(node_strength, mises, strict=True)))
