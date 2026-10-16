# SPDX-License-Identifier: AGPL-3.0-or-later
"""Thermal loads and thermal conductivities of a steady-state thermal analysis (M5.1 and
M5.2, ADR-064 and ADR-065). Physics-critical.

A fixed temperature holds every node on its faces, corner and mid-edge, at one absolute
temperature: CalculiX's degree of freedom 11 under *BOUNDARY in a *HEAT TRANSFER step. Faces
with no thermal load are insulated (no heat crosses them), which is CalculiX's default.

The other thermal loads act on element faces and element sets, as CalculiX distributes them:
a heat flux is *DFLUX with the face label Sn (positive into the body), heat generation is
*DFLUX with BF on a body's element set (per unit of volume), convection is *FILM with Fn
(coefficient and sink temperature) and radiation to surroundings at one temperature is
*RADIATE with Rn (emissivity and sink temperature; every face sees only the surroundings).
Each was checked with ccx 2.21 on a meshed bar against its closed form before use.
"""

from dataclasses import dataclass

from ...meshing.volume import VolumeMesh
from ...spec.simulation_schema import (
    ConvectionLoad,
    FixedTemperatureLoad,
    HeatFluxLoad,
    HeatGenerationLoad,
    RadiationLoad,
    SimulationSpec,
)
from ..common import DeckError, si
from ..materials import Property, positive, table
from .fixed import fixed_support_nodes
from .pressure import pressure_faces


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


def conductivities(spec: SimulationSpec, mesh: VolumeMesh) -> dict[str, Property]:
    """Thermal conductivity (W/(m·K)) of every material a body of the mesh uses, by material
    id: its table against temperature where it has one (M5.5, ADR-068), else its one value.
    DeckError for a material without either, or with a value of zero or less."""
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
        if m.thermal_conductivity_table is not None:
            out[m.id] = table(
                m.thermal_conductivity_table,
                "thermalConductivity",
                f"{what}: thermal conductivity table",
                positive,
            )
            continue
        if m.thermal_conductivity is None:
            raise DeckError(
                f"{what} has no thermal conductivity. A thermal analysis needs it; enter it."
            )
        k = si(m.thermal_conductivity, "thermalConductivity", f"{what}: thermal conductivity")
        if k <= 0.0:
            raise DeckError(f"{what}: the thermal conductivity must be greater than zero.")
        out[m.id] = k
    return out


#: The face loads of a steady-state thermal analysis other than a fixed temperature (M5.2).
type FaceHeatLoad = HeatFluxLoad | ConvectionLoad | RadiationLoad

#: What each face load is called in messages.
FACE_LOAD_KINDS: dict[type, str] = {
    HeatFluxLoad: "Heat flux",
    ConvectionLoad: "Convection",
    RadiationLoad: "Radiation",
}


def face_heat_loads(spec: SimulationSpec) -> list[FaceHeatLoad]:
    """The heat fluxes, convections and radiations of the setup, in spec order."""
    return [x for x in spec.loads if isinstance(x, HeatFluxLoad | ConvectionLoad | RadiationLoad)]


def check_face_heat_loads(spec: SimulationSpec) -> None:
    """DeckError for a face that a fixed temperature holds and another thermal load also acts
    on (the fixed temperature sets the temperature there, so the load would have no effect),
    and for a face with two convections or two radiations (CalculiX keeps one of them without
    saying which)."""
    held = {f: x for x in spec.loads if isinstance(x, FixedTemperatureLoad) for f in x.faces}
    seen: dict[tuple[type, int], FaceHeatLoad] = {}
    for load in face_heat_loads(spec):
        kind = FACE_LOAD_KINDS[type(load)]
        for face in load.faces:
            if face in held:
                raise DeckError(
                    f'{kind} "{load.name}" acts on face {face}, which fixed temperature '
                    f'"{held[face].name}" holds, so it would have no effect. Remove the face '
                    "from one of them."
                )
            if isinstance(load, HeatFluxLoad):
                continue  # fluxes on the same face add up
            other = seen.setdefault((type(load), face), load)
            if other is not load:
                raise DeckError(
                    f'{kind} "{other.name}" and "{load.name}" both act on face {face}. Give '
                    f"each face one {kind.lower()}; combine them into one if both are meant."
                )


def _ambient(load: ConvectionLoad | RadiationLoad, kind: str) -> float:
    kelvin = si(
        load.ambient_temperature, "temperature", f'{kind} "{load.name}": ambient temperature'
    )
    if kelvin <= 0.0:
        raise DeckError(
            f'{kind} "{load.name}": the ambient temperature is at or below absolute zero. Enter '
            "a temperature above 0 K."
        )
    return kelvin


def element_face_fluxes(spec: SimulationSpec, mesh: VolumeMesh) -> dict[tuple[int, int], float]:
    """The heat flux (W/m², positive into the body) on each (0-based element, CalculiX face
    number) of every heat flux load, fluxes on the same element face added up (conduction with
    fixed conductivity is linear), in key order. DeckError when a load has no flux."""
    flux: dict[tuple[int, int], float] = {}
    for load in spec.loads:
        if isinstance(load, HeatFluxLoad):
            value = si(load.flux, "heatFlux", f'Heat flux "{load.name}"')
            for key in pressure_faces(mesh, load.faces):
                flux[key] = flux.get(key, 0.0) + value
    return dict(sorted(flux.items()))


@dataclass(frozen=True)
class FaceExchange:
    """A convection or a radiation: the load, its ambient temperature (K), its coefficient
    (W/(m²·K)) or emissivity, and its (0-based element, CalculiX face number) pairs."""

    load: ConvectionLoad | RadiationLoad
    ambient: float
    value: float
    faces: list[tuple[int, int]]


def convections(spec: SimulationSpec, mesh: VolumeMesh) -> list[FaceExchange]:
    """Every convection of the setup, in spec order; DeckError for a missing value, a
    coefficient of zero or less, or an ambient temperature at or below absolute zero."""
    out = []
    for load in spec.loads:
        if not isinstance(load, ConvectionLoad):
            continue
        h = si(
            load.coefficient, "heatTransferCoefficient", f'Convection "{load.name}": coefficient'
        )
        if h <= 0.0:
            raise DeckError(f'Convection "{load.name}": the coefficient must be greater than zero.')
        out.append(
            FaceExchange(load, _ambient(load, "Convection"), h, pressure_faces(mesh, load.faces))
        )
    return out


def radiations(spec: SimulationSpec, mesh: VolumeMesh) -> list[FaceExchange]:
    """Every radiation of the setup, in spec order; DeckError for a missing value, an
    emissivity outside (0, 1], or an ambient temperature at or below absolute zero."""
    out = []
    for load in spec.loads:
        if not isinstance(load, RadiationLoad):
            continue
        if load.emissivity is None:
            raise DeckError(f'Radiation "{load.name}" has no emissivity. Enter one before running.')
        if not 0.0 < load.emissivity <= 1.0:
            raise DeckError(
                f'Radiation "{load.name}": the emissivity must be greater than 0 and at most 1.'
            )
        out.append(
            FaceExchange(
                load, _ambient(load, "Radiation"), load.emissivity, pressure_faces(mesh, load.faces)
            )
        )
    return out


def heat_generation(spec: SimulationSpec, mesh: VolumeMesh) -> dict[int, float]:
    """The heat generated (W/m³) in each body tag of every heat generation load, loads on the
    same body added up, in tag order. DeckError for a load with no bodies or no value, or with
    a body the mesh does not have."""
    out: dict[int, float] = {}
    for load in spec.loads:
        if not isinstance(load, HeatGenerationLoad):
            continue
        what = f'Heat generation "{load.name}"'
        if not load.bodies:
            raise DeckError(f"{what} has no bodies. Pick the bodies that produce the heat.")
        unknown = sorted(set(load.bodies) - set(mesh.bodies))
        if unknown:
            raise DeckError(
                f"{what} uses bodies {unknown}, which the mesh does not have. The setup and the "
                "mesh belong to different geometries; mesh the simulation again."
            )
        value = si(load.power, "heatGeneration", what)
        for tag in load.bodies:
            out[tag] = out.get(tag, 0.0) + value
    return dict(sorted(out.items()))
