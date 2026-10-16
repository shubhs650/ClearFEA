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
from ..materials import Property, expansion_reference, table


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


def expansions(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    needed_by: str = "A temperature change",
    *,
    tables: bool = False,
) -> dict[str, Property]:
    """Thermal expansion coefficient (1/K) of every material a body of the mesh uses, by
    material id; DeckError for a material without one, saying what ``needed_by`` it. With
    ``tables`` (a thermal stress analysis, M5.5, ADR-068), a material's table of mean
    coefficients, with the temperature they are measured from, replaces its one value."""
    material = {m.id: m for m in spec.materials}
    assigned = {b.tag: b.material for b in spec.bodies}
    out: dict[str, Property] = {}
    for tag in sorted(mesh.bodies):
        m = material.get(assigned.get(tag) or "")
        if m is None:
            raise DeckError(f"Body {tag} has no material. Assign a material to it.")
        if m.id in out:
            continue
        what = f'Material "{m.name}"'
        if tables and m.thermal_expansion_table is not None:
            out[m.id] = table(
                m.thermal_expansion_table, "thermalExpansion", f"{what}: thermal expansion table"
            )
            expansion_reference(m.thermal_expansion_table, f"{what}: thermal expansion table")
            continue
        if m.thermal_expansion is None:
            raise DeckError(f"{what} has no thermal expansion. {needed_by} needs it; enter it.")
        out[m.id] = si(m.thermal_expansion, "thermalExpansion", f"{what}: thermal expansion")
    return out


def stress_free_temperature(spec: SimulationSpec) -> float:
    """The stress-free temperature of a thermal stress analysis in kelvin (M5.4, ADR-067): the
    temperature at which the bodies have no thermal strain. DeckError when it is missing or at
    or below absolute zero."""
    entered = spec.stress_free_temperature
    if entered is None:
        raise DeckError(
            "The setup has no stress-free temperature, the temperature at which the bodies have "
            "no thermal strain. Enter it under Analysis."
        )
    kelvin = si(entered, "temperature", "Stress-free temperature")
    if kelvin <= 0.0:
        raise DeckError(
            "The stress-free temperature is at or below absolute zero. Enter a temperature "
            "above 0 K."
        )
    return kelvin
