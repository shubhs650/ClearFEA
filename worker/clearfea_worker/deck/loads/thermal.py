# SPDX-License-Identifier: AGPL-3.0-or-later
"""Uniform temperature change (M2.7, ADR-044): every node starts at 0 K and ends at the change.

CalculiX's thermal strain is alpha * (T - T_initial) for a constant expansion coefficient
(manual, *EXPANSION), so writing *INITIAL CONDITIONS, TYPE=TEMPERATURE at 0 and *TEMPERATURE
at the change in the step gives exactly alpha * change, whatever the absolute temperature was.
No nodal loads are applied, so reactions need no correction (deck/applied.py).
"""

from ...meshing.volume import VolumeMesh
from ...spec.simulation_schema import SimulationSpec, TemperatureLoad
from ..common import DeckError, si


def temperature_change(spec: SimulationSpec) -> tuple[TemperatureLoad, float] | None:
    """The setup's temperature change and its value in kelvin, or None without one.

    DeckError for a second one: a setup has one uniform temperature field.
    """
    found: tuple[TemperatureLoad, float] | None = None
    for load in spec.loads:
        if not isinstance(load, TemperatureLoad):
            continue
        if found is not None:
            raise DeckError(
                f'Temperature change "{load.name}" is a second one. A setup can have one '
                "temperature change; delete the other."
            )
        found = (load, si(load.change, "temperatureDifference", f"{load.name}: temperature change"))
    return found


def expansions(spec: SimulationSpec, mesh: VolumeMesh) -> dict[str, float]:
    """Thermal expansion coefficient (1/K) of every material a body of the mesh uses, by
    material id; DeckError for a material without one."""
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
        if m.thermal_expansion is None:
            raise DeckError(
                f"{what} has no thermal expansion. A temperature change needs it; enter it."
            )
        out[m.id] = si(m.thermal_expansion, "thermalExpansion", f"{what}: thermal expansion")
    return out
