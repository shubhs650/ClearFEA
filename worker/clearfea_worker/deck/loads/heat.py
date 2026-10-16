# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fixed temperatures and thermal conductivities of a steady-state thermal analysis (M5.1,
ADR-064). Physics-critical.

A fixed temperature holds every node on its faces, corner and mid-edge, at one absolute
temperature: CalculiX's degree of freedom 11 under *BOUNDARY in a *HEAT TRANSFER step. Faces
with no fixed temperature are insulated (no heat crosses them), which is CalculiX's default.
"""

from dataclasses import dataclass

from ...meshing.volume import VolumeMesh
from ...spec.simulation_schema import FixedTemperatureLoad, SimulationSpec
from ..common import DeckError, si
from .fixed import fixed_support_nodes


@dataclass(frozen=True)
class FixedTemperature:
    """One fixed temperature: the load, its value in kelvin and its nodes (0-based, sorted)."""

    load: FixedTemperatureLoad
    kelvin: float
    nodes: list[int]


def fixed_temperatures(spec: SimulationSpec, mesh: VolumeMesh) -> list[FixedTemperature]:
    """Every fixed temperature of the setup, in spec order.

    DeckError for a temperature at or below absolute zero, and for a node two fixed
    temperatures hold at different values (faces that share an edge): the solver would keep
    one of them without saying which.
    """
    out: list[FixedTemperature] = []
    owner: dict[int, FixedTemperature] = {}
    for load in spec.loads:
        if not isinstance(load, FixedTemperatureLoad):
            continue
        kelvin = si(load.temperature, "temperature", f'Fixed temperature "{load.name}"')
        if kelvin <= 0.0:
            raise DeckError(
                f'Fixed temperature "{load.name}" is at or below absolute zero. Enter a '
                "temperature above 0 K."
            )
        item = FixedTemperature(load, kelvin, fixed_support_nodes(mesh, load.faces))
        for node in item.nodes:
            other = owner.setdefault(node, item)
            if other.kelvin != kelvin:
                raise DeckError(
                    f'Fixed temperatures "{other.load.name}" and "{load.name}" hold the same '
                    "nodes, on the edge or corner their faces share, at different temperatures. "
                    "Give them the same temperature, or fix the temperature of only one of "
                    "the touching faces."
                )
        out.append(item)
    return out


def conductivities(spec: SimulationSpec, mesh: VolumeMesh) -> dict[str, float]:
    """Thermal conductivity (W/(m·K)) of every material a body of the mesh uses, by material
    id; DeckError for a material without one or with one of zero or less."""
    material = {m.id: m for m in spec.materials}
    assigned = {b.tag: b.material for b in spec.bodies}
    out = {}
    for tag in sorted(mesh.bodies):
        m = material.get(assigned.get(tag) or "")
        if m is None:
            raise DeckError(f"Body {tag} has no material. Assign a material to it.")
        if m.id in out:
            continue
        what = f'Material "{m.name}"'
        if m.thermal_conductivity is None:
            raise DeckError(
                f"{what} has no thermal conductivity. A thermal analysis needs it; enter it."
            )
        k = si(m.thermal_conductivity, "thermalConductivity", f"{what}: thermal conductivity")
        if k <= 0.0:
            raise DeckError(f"{what}: the thermal conductivity must be greater than zero.")
        out[m.id] = k
    return out
