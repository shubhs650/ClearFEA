# SPDX-License-Identifier: AGPL-3.0-or-later
"""The deck generator: SimulationSpec + volume mesh -> CalculiX input text (ADR-029).

Physics-critical. This is the only code that writes solver input (CLAUDE.md), and the one
place where entered quantities are converted to SI (ARCHITECTURE.md section 5). It is a pure
function: the same spec and mesh always give the same text, byte for byte, which the deck
snapshot tests rely on. Mesh positions are already in metres; every other value goes
through units.py.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass, field

from ..meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ..spec.simulation_schema import (
    CentrifugalLoad,
    ConvectionLoad,
    ElasticSupport,
    ExpansionTable,
    FixedSupport,
    FixedTemperatureLoad,
    ForceLoad,
    GravityLoad,
    HeatFluxLoad,
    HeatGenerationLoad,
    HydrostaticLoad,
    PrescribedDisplacement,
    PressureLoad,
    PropertyTable,
    Quantity,
    RadiationLoad,
    RemoteLoad,
    SimulationSpec,
    TemperatureLoad,
)
from .applied import force_loads
from .common import DeckError, si
from .constraints import (
    Hold,
    body_nodes,
    check_held,
    frictionless_normals,
    hold_frame,
    holds,
    node_frames,
    perpendicular,
    support_kind,
)
from .elements import CCX_NODE_ORDER, ELEMENT_TYPE
from .linalg import Vector, norm
from .loads import (
    Spring,
    body_loads,
    densities,
    elastic_springs,
    elastic_stiffness,
    element_face_pressures,
    fixed_support_nodes,
    force_vector,
    hydrostatic_values,
    remote_vectors,
    support_nodes,
)
from .loads.body import gravity_vector, rotation
from .loads.heat import (
    FACE_LOAD_KINDS,
    check_face_heat_loads,
    conductivities,
    convections,
    element_face_fluxes,
    face_heat_loads,
    fixed_temperatures,
    heat_generation,
    radiations,
)
from .loads.thermal import expansions, stress_free_temperature, temperature_change
from .loads.tie import Equation, body_groups, ties
from .materials import Property, Table, expansion_reference, poisson, positive, rows, table

#: Version of the deck layout below. Bump it when the text for the same inputs changes.
DECK_FORMAT = 5

#: CalculiX reads at most 16 entries on a data line.
_PER_LINE = 16

#: The node set of every held node, whose reaction forces are printed node by node; the result
#: reader shares them between supports (constraints.py) and takes their moments (M3.2).
REACTION_SET = "RALL"

#: The node set of every tied slave node (M4.3), whose nodal forces are printed too: the result
#: reader passes their tie forces on to held master nodes (loads/tie.py, ADR-060).
TIE_SET = "TIED"

#: The node set of every node a fixed temperature holds, whose nodal heat flows (RFL) are
#: printed node by node: the result reader takes each fixed temperature's heat flow from them
#: (results/heat.py, M5.3).
HEAT_SET = "TALL"

#: The node set of every node on a face with convection or radiation, whose temperatures are
#: printed to seven digits (the .frd file keeps five): the result reader integrates the heat
#: these faces exchange from them (M5.3).
EXCHANGE_SET = "XALL"

#: The nodes whose temperature a bond ties (M5.6), for their nodal heat flows.
HEAT_TIE_SET = "TTIED"

__all__ = [
    "DECK_FORMAT",
    "DeckError",
    "EXCHANGE_SET",
    "HEAT_SET",
    "HEAT_TIE_SET",
    "REACTION_SET",
    "TIE_SET",
    "generate_deck",
    "support_set_names",
]


#: CalculiX reads at most this many characters of a number and silently ignores the rest, so
#: "1.234567890123456e-16" (21 characters) is read as 0.1234... (checked with ccx 2.21; M1.13).
FIELD_WIDTH = 20


def _number(value: float) -> str:
    """Shortest text that reads back as the same double, in at most FIELD_WIDTH characters.

    Integers keep a decimal point. A value whose shortest text is longer is rounded to as many
    significant digits as fit (at least 13, a relative change below 1e-12).
    """
    text = repr(float(value))
    digits = 17
    while len(text) > FIELD_WIDTH:
        digits -= 1
        text = f"{float(value):.{digits}g}"
    return text


def _label(text: str) -> str:
    """A user-typed name made safe for one comment line."""
    return re.sub(r"\s+", " ", text).strip()


def _lines(values: Iterable[int]) -> list[str]:
    values = list(values)
    return [
        ", ".join(str(v) for v in values[k : k + _PER_LINE])
        for k in range(0, len(values), _PER_LINE)
    ]


_si = si


def _check_faces(mesh: VolumeMesh, faces: list[int], what: str) -> None:
    if not faces:
        raise DeckError(f"{what} has no faces. Select at least one face for it.")
    if len(set(faces)) != len(faces):
        raise DeckError(f"{what} lists a face more than once. List each face once.")
    unknown = sorted(set(faces) - set(mesh.faces))
    if unknown:
        raise DeckError(
            f"{what} uses faces {unknown}, which the mesh does not have. The setup and the "
            "mesh belong to different geometries; mesh the simulation again."
        )


def _check_support_edges(
    mesh: VolumeMesh, support: FixedSupport | PrescribedDisplacement, what: str
) -> None:
    """A fixed support or prescribed displacement holds faces, edges or both (ADR-105)."""
    edges = support.edges or []
    if not edges:
        _check_faces(mesh, support.faces, what)
        return
    if support.faces:
        _check_faces(mesh, support.faces, what)
    if len(set(edges)) != len(edges):
        raise DeckError(f"{what} lists an edge more than once. List each edge once.")
    unknown = sorted(set(edges) - set(mesh.edges))
    if unknown:
        raise DeckError(
            f"{what} uses edges {unknown}, which the mesh does not have. The mesh was made "
            "before ClearFEA kept edges, or belongs to a different geometry; mesh the "
            "simulation again."
        )


def _materials(spec: SimulationSpec, mesh: VolumeMesh) -> list[tuple[int, int, str]]:
    """(body tag, material index, CalculiX material name) for every body of the mesh."""
    assigned = {b.tag: b.material for b in spec.bodies}
    index = {m.id: k for k, m in enumerate(spec.materials)}
    extra = sorted(set(assigned) - set(mesh.bodies))
    if extra:
        raise DeckError(
            f"The setup assigns bodies {extra}, which the mesh does not have. Mesh the "
            "simulation again."
        )
    rows = []
    for tag in sorted(mesh.bodies):
        material = assigned.get(tag)
        if material is None:
            raise DeckError(f"Body {tag} has no material. Assign a material to it.")
        if material not in index:
            raise DeckError(f"Body {tag} uses material '{material}', which is not in the setup.")
        rows.append((tag, index[material], f"M{index[material] + 1}"))
    return rows


def _table_comment(what: str, entered: PropertyTable | ExpansionTable) -> list[str]:
    """Comment lines giving a property table as entered, in its units."""
    unit = "" if entered.unit is None else f" {entered.unit}"
    values = "; ".join(
        f"{_number(row.temperature or 0.0)} {entered.temperature_unit}: "
        f"{_number(row.value or 0.0)}{unit}"
        for row in entered.rows
    )
    return [f"** {what} against temperature: {values}"]


def support_set_names(spec: SimulationSpec) -> list[str]:
    """The node set of each support in the deck, in spec order; the .dat reactions use them."""
    return [f"S{k + 1}" for k in range(len(spec.supports))]


def only_fixed_supports(spec: SimulationSpec) -> bool:
    """True when every support that holds nodes is fixed (elastic supports hold none): the
    deck then holds each fixed support's node set in all three directions (the M1 layout,
    ADR-029). Otherwise nodes are held through constraint groups (ADR-039). Either way the
    reaction force of every held node is printed (M3.2)."""
    return all(isinstance(s, (FixedSupport, ElasticSupport)) for s in spec.supports)


def _elastic_springs(spec: SimulationSpec, mesh: VolumeMesh) -> list[tuple[int, list[Spring]]]:
    """(support index, springs) of every elastic support, in spec order."""
    return [
        (k, elastic_springs(mesh, s))
        for k, s in enumerate(spec.supports)
        if isinstance(s, ElasticSupport)
    ]


def _vector(v: Iterable[float]) -> str:
    return ", ".join(_number(x + 0.0) for x in v)


def _entered(*quantities: Quantity | None) -> str:
    """Components as the user entered them, for a deck comment; callers have checked them."""
    return ", ".join(f"{_number(q.value)} {q.unit}" for q in quantities if q is not None)


def _hold_lines(h: Hold) -> tuple[str | None, "_Dofs"]:
    """How a node's Hold is written: the *TRANSFORM data line or None (global axes), and the
    (degree of freedom, value or None for zero) to hold in that system (hold_frame). Values
    below 1e-12 of the node's largest are rounding left by the solve and written as zero."""
    size = max((abs(v) for v in h.values), default=0.0)

    def value(v: float) -> str | None:
        return None if abs(v) <= 1e-12 * size else _number(v)

    frame = hold_frame(h)
    if not frame.transformed:
        u = h.displacement()
        return None, [(i + 1, value(u[i])) for i in sorted(frame.held)]
    a, b, _ = frame.axes
    return f"{_vector(a)}, {_vector(b)}", [(k + 1, value(v)) for k, v in enumerate(h.values)]


def _equation_lines(equation: Equation) -> list[str]:
    """An *EQUATION entry: the number of terms, then the terms, at most four to a line (12
    entries), each node (1-based), degree of freedom (1 to 3) and coefficient."""
    entries = [f"{t.node + 1}, {t.direction + 1}, {_number(t.coefficient)}" for t in equation]
    return [str(len(equation))] + [", ".join(entries[k : k + 4]) for k in range(0, len(entries), 4)]


_Dofs = list[tuple[int, str | None]]
_Group = tuple[list[int], str | None, _Dofs]


def _constraint_groups(held: dict[int, Hold], skip: set[int]) -> list[_Group]:
    """Held nodes not in ``skip`` grouped by identical deck text: (nodes, transform, dofs)."""
    groups: dict[tuple[object, ...], _Group] = {}
    for node, h in held.items():
        if node in skip:
            continue
        transform, dofs = _hold_lines(h)
        key = (transform, tuple(dofs))
        if key not in groups:
            groups[key] = ([], transform, dofs)
        groups[key][0].append(node)
    return list(groups.values())


#: CalculiX's name for each equation solver a spec may choose (ADR-063). Every deck names its
#: solver on the step line, so the deck alone says what solved it, whatever the build's default.
SOLVER_NAMES = {
    "pastix": "PASTIX",
    "spooles": "SPOOLES",
    "iterative_cholesky": "ITERATIVE CHOLESKY",
    "iterative_scaling": "ITERATIVE SCALING",
}
#: The solver of a spec saved before ADR-063, which has none.
DEFAULT_SOLVER = "pastix"
#: Equation solvers a deck may name (M2.11, ADR-048).
SOLVERS = tuple(SOLVER_NAMES.values())


def _check_nodes(mesh: VolumeMesh) -> None:
    if len(set(mesh.elements)) != mesh.node_count:
        raise DeckError(
            f"The mesh has {mesh.node_count - len(set(mesh.elements))} nodes that belong to no "
            "element. Mesh the simulation again."
        )


def _nodes_and_elements(
    spec: SimulationSpec, mesh: VolumeMesh, bodies: list[tuple[int, int, str]], heading: str
) -> list[str]:
    """The deck's header, nodes and elements (one element set per body), shared by every
    analysis type."""
    npe = NODES_PER_ELEMENT[mesh.order]
    out = [
        f"** ClearFEA solver input, deck format {DECK_FORMAT}. Generated from the simulation's",
        "** setup and mesh; do not edit. Units: SI (m, kg, s, N, Pa"
        + (", K, W)." if spec.analysis in ("steady_thermal", "thermal_stress") else ")."),
        f"** Geometry {spec.geometry_id}",
        "*HEADING",
        heading,
        f"** {mesh.node_count} nodes, {mesh.element_count} {ELEMENT_TYPE[mesh.order]} elements",
        "*NODE, NSET=NALL",
    ]
    p = mesh.positions
    for n in range(mesh.node_count):
        x, y, z = (_number(c) for c in p[3 * n : 3 * n + 3])
        out.append(f"{n + 1}, {x}, {y}, {z}")

    order = CCX_NODE_ORDER[mesh.order]
    for tag, _, _ in bodies:
        first, count = mesh.bodies[tag]
        out.append(f"** Body {tag}")
        out.append(f"*ELEMENT, TYPE={ELEMENT_TYPE[mesh.order]}, ELSET=B{tag}")
        for e in range(first, first + count):
            nodes = mesh.elements[e * npe : (e + 1) * npe]
            # The element id and ten nodes fit on one line of at most 16 entries.
            out.append(f"{e + 1}, " + ", ".join(str(nodes[k] + 1) for k in order))
    return out


#: The Stefan-Boltzmann constant, W/(m²·K⁴): CODATA 2018, exact since the 2019 SI redefinition.
STEFAN_BOLTZMANN = 5.670374419e-8

#: The loads a steady-state thermal analysis takes (M5.1, M5.2).
_THERMAL_LOADS = (FixedTemperatureLoad, HeatGenerationLoad, *FACE_LOAD_KINDS)

#: Each analysis type's name in the deck's heading and in messages.
_ANALYSIS_NAMES = {
    "linear_static": "linear static",
    "steady_thermal": "steady-state thermal",
    "thermal_stress": "thermal stress",
    "modal": "modal",
}

#: The equation solvers a *FREQUENCY step can use: CalculiX refuses its iterative ones there
#: (frequencys.f), as its Lanczos method needs the factorised stiffness (M6.1, ADR-070).
FREQUENCY_SOLVERS = ("SPOOLES",)


@dataclass
class _Parts:
    """The deck text of one step and what the model section needs for it, in deck order:
    node sets and other model data before the materials, each used material's lines (by
    material id, after its *MATERIAL line), lines after the solid sections, the comments that
    describe the loads, lines before the first step, and the step itself."""

    sets: list[str] = field(default_factory=list)
    materials: dict[str, list[str]] = field(default_factory=dict)
    sections: list[str] = field(default_factory=list)
    comments: list[str] = field(default_factory=list)
    prelude: list[str] = field(default_factory=list)
    step: list[str] = field(default_factory=list)


def _deck(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    bodies: list[tuple[int, int, str]],
    parts: list[_Parts],
) -> str:
    """The whole deck: header, nodes and elements, then each part's text in deck order, steps
    last in the order given."""
    out = _nodes_and_elements(
        spec, mesh, bodies, f"ClearFEA {_ANALYSIS_NAMES[spec.analysis]} analysis"
    )
    for part in parts:
        out.extend(part.sets)
    for j, material in enumerate(spec.materials):
        lines = [x for part in parts for x in part.materials.get(material.id, [])]
        if not lines:
            continue
        out.append(f'** Material {material.id} "{_label(material.name)}"')
        out.append(f"*MATERIAL, NAME=M{j + 1}")
        out.extend(lines)
    for tag, _, name in bodies:
        out.append(f"*SOLID SECTION, ELSET=B{tag}, MATERIAL={name}")
    for part in parts:
        out.extend(part.sections)
    for part in parts:
        out.extend(part.comments)
    for part in parts:
        out.extend(part.prelude)
    for part in parts:
        out.extend(part.step)
    return "\n".join(out) + "\n"


def _heat_parts(
    spec: SimulationSpec,
    mesh: VolumeMesh,
    bodies: list[tuple[int, int, str]],
    solver: str,
    *,
    initial: float | None = None,
) -> _Parts:
    """The heat transfer step (M5.1, ADR-064; M5.2, ADR-065): conduction, with fixed
    temperatures, heat fluxes, convection and radiation on faces and heat generation in bodies;
    every other face insulated. Temperatures in kelvin. ``initial``, when given, is every
    node's starting temperature (a thermal stress analysis's stress-free temperature, M5.4);
    otherwise radiation starts every node at the mean of the known temperatures."""
    if spec.analysis == "steady_thermal":
        wrong = [*spec.supports, *(x for x in spec.loads if not isinstance(x, _THERMAL_LOADS))]
        if wrong:
            raise DeckError(
                f'"{wrong[0].name}" has no effect in a steady-state thermal analysis. Delete it, '
                "or set the analysis type to linear static."
            )
    fixed = [x for x in spec.loads if isinstance(x, FixedTemperatureLoad)]
    face_loads = face_heat_loads(spec)
    # Convection and radiation tie the temperature to their ambient, as a fixed temperature does.
    anchors = [*fixed, *(x for x in face_loads if not isinstance(x, HeatFluxLoad))]
    if not anchors:
        raise DeckError(
            "The setup has no fixed temperature, convection or radiation, so the temperatures "
            "are not set anywhere. Add a fixed temperature, or convection or radiation to the "
            "surroundings."
        )
    for load in [*fixed, *face_loads]:
        _check_faces(mesh, load.faces, f"{load.name}")
    check_face_heat_loads(spec)
    k = conductivities(spec, mesh)
    _check_nodes(mesh)
    held = fixed_temperatures(spec, mesh)
    flux = element_face_fluxes(spec, mesh)
    films = convections(spec, mesh)
    radiates = radiations(spec, mesh)
    generated = heat_generation(spec, mesh)
    held_nodes = {n for item in held for n in item.nodes}
    # Bonds carry heat (M5.6): each slave node's temperature follows the master face's.
    heat_ties = ties(spec, mesh, {}, temperature=held_nodes)
    # Bodies share no nodes (ADR-058), so each body, or each group of bonded bodies, needs a
    # fixed temperature, convection or radiation of its own, or its temperature is
    # undetermined and the equations singular.
    nodes = set(held_nodes)
    for item in [*films, *radiates]:
        nodes.update(fixed_support_nodes(mesh, item.load.faces))
    unset = [group for group in body_groups(mesh, heat_ties) if not nodes & body_nodes(mesh, group)]
    if unset:
        tags = [t for group in unset for t in group]
        joined = ", ".join(str(t) for t in tags)
        raise DeckError(
            f"Body {joined} has no fixed temperature, convection or radiation and is not bonded "
            "to a body that has one, so its temperature is not set. Add one on one of its faces."
            if len(tags) == 1
            else f"Bodies {joined} have no fixed temperature, convection or radiation and are not "
            "bonded to a body that has one, so their temperatures are not set. Add one on a "
            "face of each group of bonded bodies."
        )

    parts = _Parts()
    out = parts.sets
    for j, item in enumerate(held):
        load, entered = item.load, item.load.temperature
        assert entered is not None  # fixed_temperatures refuses a missing temperature
        out.append(
            f'** Fixed temperature {load.id} "{_label(load.name)}", faces '
            + ", ".join(str(f) for f in load.faces)
            + f": {_number(entered.value)} {entered.unit} = {_number(item.kelvin)} K"
        )
        out.append(f"*NSET, NSET=T{j + 1}")
        out.extend(_lines(n + 1 for n in item.nodes))
    if held:
        out.append(f"*NSET, NSET={HEAT_SET}")
        out.extend(_lines(sorted({n + 1 for item in held for n in item.nodes})))
    exchanged = sorted(
        {n + 1 for item in [*films, *radiates] for n in fixed_support_nodes(mesh, item.load.faces)}
    )
    if exchanged:
        out.append(f"*NSET, NSET={EXCHANGE_SET}")
        out.extend(_lines(exchanged))
    heat_tied: list[int] = []
    if heat_ties:
        out.append("** Bonds carry heat (M5.6): the temperature of each node of one face of each")
        out.append("** bond follows the other face's at the point closest to it (*EQUATION on")
        out.append("** degree of freedom 11; loads/tie.py)")
    for tie in heat_ties:
        out.append(
            f"** Heat bond of faces {tie.bond[0]} and {tie.bond[1]}: face {tie.slave} (body "
            f"{tie.slave_body}) follows face {tie.master} (body {tie.master_body}); "
            f"{tie.tied} of {tie.nodes} nodes tied,"
        )
        out.append(
            f"** {tie.held} at a fixed temperature, {tie.off} off face {tie.master}, "
            f"{tie.shared} tied by another bond"
        )
        if tie.equations:
            out.append("*EQUATION")
            for equation in tie.equations:
                out.extend(_equation_lines(equation))
        heat_tied.extend(dict.fromkeys(e[0].node for e in tie.equations))
    if heat_tied:
        out.append(f"*NSET, NSET={HEAT_TIE_SET}")
        out.extend(_lines(n + 1 for n in heat_tied))
    for material in spec.materials:
        if material.id not in k:
            continue
        conductivity = k[material.id]
        if isinstance(conductivity, Table):
            entered_table = material.thermal_conductivity_table
            assert entered_table is not None  # conductivities() took the table from it
            parts.materials[material.id] = [
                *_table_comment("Thermal conductivity", entered_table),
                "*CONDUCTIVITY",
                *(f"{_number(v)}, {_number(t)}" for t, v in conductivity.points),
            ]
            continue
        entered = material.thermal_conductivity
        assert entered is not None  # conductivities() refuses a missing one
        parts.materials[material.id] = [
            f"** Thermal conductivity {_number(entered.value)} {entered.unit}",
            "*CONDUCTIVITY",
            _number(conductivity),
        ]
    out = parts.comments
    for load in spec.loads:
        if isinstance(load, HeatFluxLoad):
            entered = load.flux
            assert entered is not None  # element_face_fluxes refuses a missing flux
            out.append(
                f'** Heat flux {load.id} "{_label(load.name)}", faces '
                + ", ".join(str(f) for f in load.faces)
                + f": {_number(entered.value)} {entered.unit} = "
                + f"{_number(si(entered, 'heatFlux', load.name))} W/m² into the body"
            )
        elif isinstance(load, HeatGenerationLoad):
            entered = load.power
            assert entered is not None  # heat_generation refuses a missing value
            out.append(
                f'** Heat generation {load.id} "{_label(load.name)}", bodies '
                + ", ".join(str(b) for b in load.bodies)
                + f": {_number(entered.value)} {entered.unit} = "
                + f"{_number(si(entered, 'heatGeneration', load.name))} W/m³"
            )
    for item in films:
        load = item.load
        assert isinstance(load, ConvectionLoad) and load.coefficient is not None
        assert load.ambient_temperature is not None  # convections() refuses missing values
        h, t = load.coefficient, load.ambient_temperature
        out.append(
            f'** Convection {load.id} "{_label(load.name)}", faces '
            + ", ".join(str(f) for f in load.faces)
            + f": {_number(h.value)} {h.unit} = {_number(item.value)} W/(m²·K) to "
            + f"{_number(t.value)} {t.unit} = {_number(item.ambient)} K"
        )
    for item in radiates:
        load = item.load
        assert isinstance(load, RadiationLoad) and load.ambient_temperature is not None
        t = load.ambient_temperature
        out.append(
            f'** Radiation {load.id} "{_label(load.name)}", faces '
            + ", ".join(str(f) for f in load.faces)
            + f": emissivity {_number(item.value)} to {_number(t.value)} {t.unit} = "
            + f"{_number(item.ambient)} K"
        )
    out = parts.prelude
    varies = any(isinstance(v, Table) for v in k.values())
    if radiates or varies:
        # Temperatures are in kelvin. Radiation makes the step nonlinear, and CalculiX starts
        # its iterations from the initial temperature, 0 unless given (the linearised
        # radiation is then zero and the first iteration diverges; checked with ccx 2.21), so
        # every node starts at the mean of the setup's fixed and ambient temperatures.
        # A conductivity that varies with temperature (M5.5) makes the step nonlinear too, and
        # its first iteration uses the conductivity at the starting temperature.
        if radiates:
            out.append(
                "*PHYSICAL CONSTANTS, ABSOLUTE ZERO=0.0, "
                f"STEFAN BOLTZMANN={_number(STEFAN_BOLTZMANN)}"
            )
        if initial is None:
            known = [x.kelvin for x in held] + [x.ambient for x in [*films, *radiates]]
            initial = sum(known) / len(known)
    if initial is not None:
        out.append("*INITIAL CONDITIONS, TYPE=TEMPERATURE")
        out.append(f"NALL, {_number(initial)}")

    out = parts.step
    out.append("*STEP")
    step = "*HEAT TRANSFER, STEADY STATE"
    out.append(f"{step}, SOLVER={solver}")
    # CalculiX treats every heat transfer step as nonlinear and warns unless the first time
    # increment and the step time are given; a linear steady state needs one increment.
    out.append("1.0, 1.0")
    if varies:
        # A conductivity table makes the step nonlinear. CalculiX stops iterating when the heat
        # flux residual is 0.005 and the temperature correction 0.01 of their averages, which
        # left a bar's heat flows 1e-4 out of balance; at 1e-5 of each it was 1.5e-7, in two
        # more iterations (checked with ccx 2.21; ADR-068).
        out.append("*CONTROLS, PARAMETERS=FIELD")
        out.append("1e-5, 1e-5")
    out.append("*BOUNDARY")
    # Degree of freedom 11 is the temperature.
    out.extend(f"T{j + 1}, 11, 11, {_number(item.kelvin)}" for j, item in enumerate(held))
    # Heat fluxes on the same element face add up, so each face gets one line.
    if flux or generated:
        out.append("*DFLUX")
        out.extend(
            f"{element + 1}, S{face}, {_number(value)}" for (element, face), value in flux.items()
        )
        out.extend(f"B{tag}, BF, {_number(value)}" for tag, value in generated.items())
    if films:
        out.append("*FILM")
        for item in films:
            out.extend(
                f"{element + 1}, F{face}, {_number(item.ambient)}, {_number(item.value)}"
                for element, face in item.faces
            )
    if radiates:
        out.append("*RADIATE")
        for item in radiates:
            out.extend(
                f"{element + 1}, R{face}, {_number(item.ambient)}, {_number(item.value)}"
                for element, face in item.faces
            )
    out.append("*NODE FILE")
    out.append("NT")
    # The heat flux at the nodes, extrapolated from the integration points and averaged like
    # the stress (M5.3).
    out.append("*EL FILE")
    out.append("HFL")
    if held:
        out.append(f"*NODE PRINT, NSET={HEAT_SET}")
        out.append("RFL")
    if exchanged:
        out.append(f"*NODE PRINT, NSET={EXCHANGE_SET}")
        out.append("NT")
    if heat_tied:
        # The heat each tied node passes to the face it follows (results/heat.py, M5.6).
        out.append(f"*NODE PRINT, NSET={HEAT_TIE_SET}")
        out.append("RFL")
    out.append("*END STEP")
    return parts


def generate_deck(spec: SimulationSpec, mesh: VolumeMesh, *, solver: str | None = None) -> str:
    """CalculiX input for the analysis of ``spec`` on ``mesh``: linear static, steady-state
    thermal (M5.1), thermal stress (M5.4): a heat transfer step, then a static step on the
    temperatures it solved, or modal (M6.1): a frequency step on the supported bodies.

    The step lines (``*STATIC``, ``*HEAT TRANSFER`` or ``*FREQUENCY``) name the spec's
    equation solver (ADR-063); ``solver``, a CalculiX name from SOLVERS, replaces it for the
    solver benchmark (M2.11). Raises DeckError when the spec is incomplete or does not fit the mesh.
    """
    if solver is None:
        solver = SOLVER_NAMES[spec.solver or DEFAULT_SOLVER]
    elif solver not in SOLVERS:
        raise DeckError(f"Unknown equation solver '{solver}'.")
    if spec.analysis == "steady_thermal":
        bodies = _materials(spec, mesh)
        return _deck(spec, mesh, bodies, [_heat_parts(spec, mesh, bodies, solver)])
    if spec.analysis == "thermal_stress":
        # The static step's thermal strain is the expansion times the solved temperature minus
        # every node's initial temperature, so the nodes start at the stress-free temperature
        # (checked with ccx 2.21: a bar with a linear temperature, free to grow, moved as the
        # closed form says and had no stress; ADR-067).
        reference = stress_free_temperature(spec)
        static = _static_parts(spec, mesh, solver)
        bodies = _materials(spec, mesh)
        heat = _heat_parts(spec, mesh, bodies, solver, initial=reference)
        return _deck(spec, mesh, bodies, [heat, static])
    if spec.analysis == "modal":
        # CalculiX refuses its iterative solvers on a frequency step (ADR-070), and its PaStiX
        # interface corrupts memory there and stops on about one run in three (ADR-072).
        if solver == "PASTIX":
            raise DeckError(
                "PaStiX is not used for modal analysis: in ClearFEA's solver benchmark it stopped "
                "with a memory error on about one modal run in three. Choose SPOOLES as the "
                "equation solver."
            )
        if solver not in FREQUENCY_SOLVERS:
            raise DeckError(
                "CalculiX's iterative solvers cannot find natural frequencies. Choose SPOOLES as "
                "the equation solver."
            )
        modal = _static_parts(spec, mesh, solver)
        return _deck(spec, mesh, _materials(spec, mesh), [modal])
    if spec.analysis != "linear_static":
        raise DeckError(f"Analysis type '{spec.analysis}' is not supported.")
    static = _static_parts(spec, mesh, solver)
    return _deck(spec, mesh, _materials(spec, mesh), [static])


def _static_parts(spec: SimulationSpec, mesh: VolumeMesh, solver: str) -> _Parts:
    """The linear static step and its model data (supports, springs, bonds, elastic
    materials). In a thermal stress analysis (M5.4) it follows the heat transfer step, takes
    its temperatures, and has no temperature change of its own. In a modal analysis (M6.1,
    ADR-070) the step is a frequency step instead, on the same model data with each material's
    density for the mass, no loads, and supports that need not hold every rigid-body motion: a
    free body has rigid-body modes at or near zero."""
    thermal_stress = spec.analysis == "thermal_stress"
    modal = spec.analysis == "modal"
    if modal:
        if spec.loads:
            raise DeckError(
                f'"{spec.loads[0].name}" has no effect in a modal analysis, which finds the '
                "natural frequencies of the bodies as they are held, without loads. Delete it, or "
                "set the analysis type to linear static."
            )
        if spec.modes is None:
            raise DeckError(
                "There is no number of modes. Enter how many natural frequencies to find."
            )
        for support in spec.supports:
            if isinstance(support, PrescribedDisplacement) and any(
                c is not None and c != "free" and c.value != 0.0
                for c in (support.x, support.y, support.z)
            ):
                raise DeckError(
                    f'Support "{support.name}" moves its faces, which a modal analysis cannot do: '
                    "it finds vibrations about the held position. Set its components to 0 or free."
                )
    thermal_loads = [x for x in spec.loads if isinstance(x, _THERMAL_LOADS)]
    if thermal_loads and not thermal_stress:
        kind = {FixedTemperatureLoad: "Fixed temperature", HeatGenerationLoad: "Heat generation"}
        what = (kind | FACE_LOAD_KINDS)[type(thermal_loads[0])]
        raise DeckError(
            f'{what} "{thermal_loads[0].name}" has no effect in a linear static analysis. '
            "Delete it, or set the analysis type to steady-state thermal."
        )
    if thermal_stress:
        changes = [x for x in spec.loads if isinstance(x, TemperatureLoad)]
        if changes:
            raise DeckError(
                f'Temperature change "{changes[0].name}" has no effect in a thermal stress '
                "analysis, whose temperatures come from its thermal step. Delete it, or set the "
                "analysis type to linear static."
            )
    if not spec.supports and not modal:
        raise DeckError("The setup has no supports, so the part is free to move. Add a support.")
    structural = [x for x in spec.loads if not isinstance(x, _THERMAL_LOADS)]
    for item in (*spec.supports, *structural):
        if isinstance(item, (FixedSupport, PrescribedDisplacement)):
            _check_support_edges(mesh, item, f"{item.name}")
        elif not isinstance(item, (GravityLoad, CentrifugalLoad, TemperatureLoad)):
            _check_faces(mesh, item.faces, f"{item.name}")
    bodies = _materials(spec, mesh)
    gravity, spin = body_loads(spec)
    if gravity is not None or spin is not None:
        densities(spec, mesh)  # body loads need every body's density; DeckError names a gap
    if modal:
        densities(spec, mesh, "A modal analysis needs it for the mass")
    thermal = temperature_change(spec)
    if thermal_stress:
        alpha = expansions(spec, mesh, "A thermal stress analysis", tables=True)
    else:
        alpha = {} if thermal is None else expansions(spec, mesh)

    _check_nodes(mesh)
    held = holds(spec, mesh)
    springs = _elastic_springs(spec, mesh)
    tie_list = ties(spec, mesh, node_frames(held))
    held_springs = [s for _, group in springs for s in group]
    if not modal:
        # A modal analysis finds the rigid-body modes of what nothing holds instead (ADR-070);
        # it is solved with SPOOLES, which handles the indefinite K - 1·M of a free body.
        check_held(mesh, held, held_springs, body_groups(mesh, tie_list))
    fixed_only = only_fixed_supports(spec)
    normals = {} if fixed_only else frictionless_normals(spec, mesh)

    parts = _Parts()
    out = parts.sets
    support_sets = support_set_names(spec)
    fixed_nodes: set[int] = set()
    for support, name in zip(spec.supports, support_sets, strict=True):
        edges: list[int] = []
        if isinstance(support, (FixedSupport, PrescribedDisplacement)):
            nodes = support_nodes(mesh, support)
            edges = support.edges or []
        else:
            nodes = fixed_support_nodes(mesh, support.faces)
        held_on = []
        if support.faces or not edges:
            held_on.append("faces " + ", ".join(str(f) for f in support.faces))
        if edges:
            held_on.append("edges " + ", ".join(str(e) for e in edges))
        line = f'** {support_kind(support)} {support.id} "{_label(support.name)}", ' + "; ".join(
            held_on
        )
        if isinstance(support, ElasticSupport):
            k = elastic_stiffness(support)
            assert support.stiffness is not None  # elastic_stiffness refuses a missing one
            line += (
                f": foundation stiffness {_number(support.stiffness.value)} "
                f"{support.stiffness.unit} = {_number(k)} N/m^3"
            )
        elif isinstance(support, PrescribedDisplacement):
            given = []
            for axis, component in zip("xyz", (support.x, support.y, support.z), strict=True):
                if component == "free" or component is None:
                    given.append(f"{axis} free")
                else:
                    value = _si(component, "length", f"{support.name}: {axis} component")
                    given.append(
                        f"{axis} {_number(component.value)} {component.unit} = {_number(value)} m"
                    )
            line += ": " + ", ".join(given)
        elif not isinstance(support, FixedSupport):
            line += "; normals " + "; ".join(
                f"{tag}: ({_vector(normals[tag])})" for tag in support.faces
            )
        else:
            fixed_nodes.update(nodes)
        out.append(line)
        out.append(f"*NSET, NSET={name}")
        out.extend(_lines(n + 1 for n in nodes))

    groups = [] if fixed_only else _constraint_groups(held, fixed_nodes)
    if groups:
        out.append("** Nodes held by prescribed displacements and frictionless supports, grouped")
        out.append("** by how they are held; a *TRANSFORM gives a group its own directions 1 to 3")
    for k, (nodes, transform, _) in enumerate(groups):
        out.append(f"*NSET, NSET=C{k + 1}")
        out.extend(_lines(n + 1 for n in nodes))
        if transform is not None:
            out.append(f"*TRANSFORM, NSET=C{k + 1}, TYPE=R")
            out.append(transform)
    # A modal analysis prints no reactions (M6.1), so it needs neither node set.
    if held and not modal:
        out.append(f"*NSET, NSET={REACTION_SET}")
        out.extend(_lines(n + 1 for n in held))

    # Grounded springs (SPRING1), one element set per direction and stiffness. A direction
    # along a global axis is that degree of freedom; any other gets an *ORIENTATION whose
    # local x axis it is, and the spring acts along local direction 1.
    directions: dict[str, tuple[str | None, int, Vector]] = {}
    spring_sets: dict[tuple[str, str], list[tuple[int, int]]] = {}
    element = mesh.element_count
    for _, group in springs:
        for spring in group:
            d = spring.direction
            key = _vector(d)
            if key not in directions:
                if sorted(abs(c) for c in d) == [0.0, 0.0, 1.0]:
                    directions[key] = (None, max(range(3), key=lambda i: abs(d[i])) + 1, d)
                else:
                    named = sum(o is not None for o, _, _ in directions.values())
                    directions[key] = (f"O{named + 1}", 1, d)
            element += 1
            spring_sets.setdefault((key, _number(spring.stiffness)), []).append(
                (element, spring.node + 1)
            )
    if springs:
        out.append("** Elastic supports: a grounded spring per node and face along the face's")
        out.append("** normal at the node, stiffness = foundation stiffness x the node's share of")
        out.append("** the face area (N/m)")
    for j, members in enumerate(spring_sets.values()):
        out.append(f"*ELEMENT, TYPE=SPRING1, ELSET=K{j + 1}")
        out.extend(f"{e}, {n}" for e, n in members)
    for key, (name, _, d) in directions.items():
        if name is not None:
            out.append(f"*ORIENTATION, NAME={name}, SYSTEM=RECTANGULAR")
            out.append(f"{key}, {_vector(perpendicular(d))}")

    tied: list[int] = []
    if tie_list:
        out.append(
            "** Bonds (M4.3): the nodes of one face of each bond follow the other face, each"
        )
        out.append("** node as the point of the other face closest to it (*EQUATION in the node's")
        out.append("** own directions; loads/tie.py)")
    for tie in tie_list:
        out.append(
            f"** Bond of faces {tie.bond[0]} and {tie.bond[1]}: face {tie.slave} (body "
            f"{tie.slave_body}) follows face {tie.master} (body {tie.master_body}); "
            f"{tie.tied} of {tie.nodes} nodes tied,"
        )
        out.append(
            f"** {tie.held} held by supports, {tie.off} off face {tie.master}, "
            f"{tie.shared} tied by another bond"
        )
        if tie.equations:
            out.append("*EQUATION")
            for equation in tie.equations:
                out.extend(_equation_lines(equation))
        tied.extend(dict.fromkeys(e[0].node for e in tie.equations))
    if tied and not modal:
        out.append(f"*NSET, NSET={TIE_SET}")
        out.extend(_lines(n + 1 for n in tied))

    for k, material in enumerate(spec.materials):
        if not any(index == k for _, index, _ in bodies):
            continue
        out = parts.materials.setdefault(material.id, [])
        what = f"Material {material.name}"
        modulus: Property
        ratio: Property
        if thermal_stress and material.youngs_modulus_table is not None:
            modulus = table(
                material.youngs_modulus_table,
                "pressure",
                f"{what}: Young's modulus table",
                positive,
            )
            out.extend(_table_comment("Young's modulus", material.youngs_modulus_table))
        else:
            modulus = _si(material.youngs_modulus, "pressure", f"{what}: Young's modulus")
            if modulus <= 0:
                raise DeckError(f"{what}: Young's modulus must be greater than zero.")
        if thermal_stress and material.poissons_ratio_table is not None:
            ratio = table(
                material.poissons_ratio_table, None, f"{what}: Poisson's ratio table", poisson
            )
            out.extend(_table_comment("Poisson's ratio", material.poissons_ratio_table))
        else:
            if material.poissons_ratio is None:
                raise DeckError(f"{what}: Poisson's ratio has no value. Enter one before running.")
            ratio = material.poissons_ratio
        out.append("*ELASTIC")
        # One line per temperature of either table, both interpolated there (deck/materials.py).
        for kelvin, (e, nu) in rows([modulus, ratio]):
            line = f"{_number(e)}, {_number(nu)}"
            out.append(line if kelvin is None else f"{line}, {_number(kelvin)}")
        if material.density is not None:
            rho = _si(material.density, "density", f"{what}: density")
            if rho <= 0:
                raise DeckError(f"{what}: the density must be greater than zero.")
            out.append(f"** Density {_number(material.density.value)} {material.density.unit}")
            out.append("*DENSITY")
            out.append(_number(rho))
        coefficient = alpha.get(material.id)
        if isinstance(coefficient, Table):
            # Mean coefficients measured from the reference temperature, as CalculiX reads
            # them with ZERO=: the strain at T is alpha(T) (T - ZERO) less the same at the
            # initial (stress-free) temperature (checked with ccx 2.21; ADR-068).
            entered_table = material.thermal_expansion_table
            assert entered_table is not None  # expansions() took the table from it
            zero = expansion_reference(entered_table, f"{what}: thermal expansion table")
            reference = entered_table.reference_temperature
            assert reference is not None  # expansion_reference refuses a missing one
            out.extend(_table_comment("Thermal expansion", entered_table))
            out.append(
                f"** mean coefficients from {_number(reference.value)} {reference.unit} = "
                f"{_number(zero)} K"
            )
            out.append(f"*EXPANSION, ZERO={_number(zero)}")
            out.extend(f"{_number(v)}, {_number(t)}" for t, v in coefficient.points)
        elif coefficient is not None:
            entered = material.thermal_expansion
            assert entered is not None  # expansions() refuses a missing one
            out.append(f"** Thermal expansion {_number(entered.value)} {entered.unit}")
            out.append("*EXPANSION")
            out.append(_number(coefficient))
    out = parts.sections
    for j, (key, stiffness) in enumerate(spring_sets):
        name, dof, _ = directions[key]
        out.append(f"*SPRING, ELSET=K{j + 1}" + ("" if name is None else f", ORIENTATION={name}"))
        out.append(str(dof))
        out.append(stiffness)

    out = parts.comments
    for load in structural:
        if isinstance(load, PressureLoad):
            value = _si(load.magnitude, "pressure", f"{load.name}: magnitude")
            entered = load.magnitude
            assert entered is not None  # _si refuses a missing magnitude
            out.append(
                f'** Pressure {load.id} "{_label(load.name)}", faces '
                + ", ".join(str(f) for f in load.faces)
                + f": {_number(entered.value)} {entered.unit} = {_number(value)} Pa"
            )
        elif isinstance(load, ForceLoad):
            out.append(
                f'** Force {load.id} "{_label(load.name)}", faces '
                + ", ".join(str(f) for f in load.faces)
                + f": ({_entered(load.x, load.y, load.z)}) = ({_vector(force_vector(load))}) N,"
                + " spread over the faces by area"
            )
        elif isinstance(load, RemoteLoad):
            point, force, moment = remote_vectors(load)
            out.append(
                f'** Remote load {load.id} "{_label(load.name)}", faces '
                + ", ".join(str(f) for f in load.faces)
                + ": at ("
                + _entered(load.point.x, load.point.y, load.point.z)
                + f") = ({_vector(point)}) m"
            )
            out.append(
                f"** force ({_entered(load.force.x, load.force.y, load.force.z)})"
                + f" = ({_vector(force)}) N"
            )
            out.append(
                f"** moment ({_entered(load.moment.x, load.moment.y, load.moment.z)})"
                + f" = ({_vector(moment)}) N*m, carried to the faces as a linear traction"
            )
        elif isinstance(load, HydrostaticLoad):
            density, gravity_on_fluid, surface = hydrostatic_values(load)
            g, s = load.gravity, load.free_surface
            out.append(
                f'** Hydrostatic pressure {load.id} "{_label(load.name)}", faces '
                + ", ".join(str(f) for f in load.faces)
                + f": fluid density {_entered(load.fluid_density)} = {_number(density)} kg/m^3"
            )
            out.append(
                f"** gravity ({_entered(g.x, g.y, g.z)}) = ({_vector(gravity_on_fluid)}) m/s^2"
            )
            out.append(
                f"** free surface through ({_entered(s.x, s.y, s.z)}) = ({_vector(surface)}) m,"
                + " pressure written as nodal loads"
            )
        elif isinstance(load, GravityLoad):
            out.append(
                f'** Gravity {load.id} "{_label(load.name)}": '
                + f"({_entered(load.x, load.y, load.z)}) = ({_vector(gravity_vector(load))}) m/s^2"
            )
        elif isinstance(load, TemperatureLoad):
            assert thermal is not None and load.change is not None
            out.append(
                f'** Temperature change {load.id} "{_label(load.name)}": '
                + f"{_number(load.change.value)} {load.change.unit} = {_number(thermal[1])} K,"
                + " every node from 0 to the change"
            )
        else:
            r = rotation(load)
            w = load.angular_velocity
            assert w is not None  # rotation() refuses a missing angular velocity
            out.append(
                f'** Centrifugal load {load.id} "{_label(load.name)}": '
                + f"{_number(w.value)} {w.unit} = {_number(r.omega)} rad/s about the axis through"
            )
            out.append(f"** ({_vector(r.point)}) m along ({_vector(r.axis)})")
    cloads = force_loads(spec, mesh)
    # Pressures on the same element face add up (linear analysis), so each face gets one line.
    pressure = element_face_pressures(spec, mesh)
    if thermal is not None:
        parts.prelude.append("*INITIAL CONDITIONS, TYPE=TEMPERATURE")
        parts.prelude.append("NALL, 0.0")

    out = parts.step
    out.append("*STEP")
    if modal:
        assert spec.modes is not None  # refused above
        _frequency_step(out, spec, support_sets, groups, spec.modes, solver)
        return parts
    out.append(f"*STATIC, SOLVER={solver}")
    if thermal_stress:
        # After a heat transfer step CalculiX treats the static step as nonlinear and warns
        # unless its increments are given; it is linear, so one increment of the whole step.
        out.append("1.0, 1.0, 1.0, 1.0")
    out.append("*BOUNDARY")
    for support, name in zip(spec.supports, support_sets, strict=True):
        if isinstance(support, FixedSupport):
            out.append(f"{name}, 1, 3")
    for k, (_, _, dofs) in enumerate(groups):
        out.extend(
            f"C{k + 1}, {dof}, {dof}" + ("" if value is None else f", {value}")
            for dof, value in dofs
        )
    if pressure:
        out.append("*DLOAD")
        out.extend(
            f"{element + 1}, P{face}, {_number(value)}"
            for (element, face), value in sorted(pressure.items())
        )
    if cloads:
        out.append("*CLOAD")
        for node, force in cloads.items():
            out.extend(
                f"{node + 1}, {i + 1}, {_number(force[i])}" for i in range(3) if force[i] != 0.0
            )
    body: list[str] = []
    if gravity is not None and norm(gravity) > 0.0:
        size = norm(gravity)
        direction = _vector(g / size for g in gravity)
        body.extend(f"B{tag}, GRAV, {_number(size)}, {direction}" for tag, _, _ in bodies)
    if spin is not None and spin.omega != 0.0:
        axis = f"{_vector(spin.point)}, {_vector(spin.axis)}"
        body.extend(f"B{tag}, CENTRIF, {_number(spin.omega**2)}, {axis}" for tag, _, _ in bodies)
    if body:
        out.append("*DLOAD")
        out.extend(body)
    if thermal is not None:
        out.append("*TEMPERATURE")
        out.append(f"NALL, {_number(thermal[1])}")
    out.append("*NODE FILE")
    out.append("U")
    # Stress and total strain (elastic plus thermal), both extrapolated to the nodes (ADR-050).
    out.append("*EL FILE")
    out.append("S, E")
    # The displacement of an elastic support's nodes gives its reaction (loads/elastic.py).
    for k, _ in springs:
        out.append(f"*NODE PRINT, NSET={support_sets[k]}, GLOBAL=YES")
        out.append("U")
    if held:
        # Node by node, in global axes (a transformed node's forces are otherwise printed in
        # its own axes; checked with ccx 2.21), for reaction moments and so that a node two
        # supports share is counted once (M3.2, ADR-051).
        out.append(f"*NODE PRINT, NSET={REACTION_SET}, GLOBAL=YES")
        out.append("RF")
    if tied:
        out.append(f"*NODE PRINT, NSET={TIE_SET}, GLOBAL=YES")
        out.append("RF")
    out.append("*END STEP")
    return parts


def _frequency_step(
    out: list[str],
    spec: SimulationSpec,
    support_sets: list[str],
    groups: list[_Group],
    modes: int,
    solver: str,
) -> None:
    """The frequency step of a modal analysis (M6.1, ADR-070), after its *STEP line: the
    lowest ``modes`` eigenvalues and mode shapes of the held bodies by CalculiX's Lanczos
    method, the supports' held directions at zero. CalculiX writes the eigenvalues and
    frequencies to the .dat file and each mode shape, mass-normalised, to the .frd file."""
    # The data line gives the number of eigenvalues only: no frequency range, so the lowest
    # ones come out, and the Lanczos shift stays CalculiX's 1 (rad/s)², which a free body's
    # singular stiffness needs (arpack.c; checked with ccx 2.21 on a free bar).
    out.append(f"*FREQUENCY, SOLVER={solver}")
    out.append(str(modes))
    holds_any = any(isinstance(s, FixedSupport) for s in spec.supports) or groups
    if holds_any:
        out.append("*BOUNDARY")
    for support, name in zip(spec.supports, support_sets, strict=True):
        if isinstance(support, FixedSupport):
            out.append(f"{name}, 1, 3")
    # A frequency step sets every held value to zero (frequencys.f); a prescribed displacement
    # other than zero is refused before, so the values are zero already.
    for k, (_, _, dofs) in enumerate(groups):
        out.extend(f"C{k + 1}, {dof}, {dof}" for dof, _ in dofs)
    out.append("*NODE FILE")
    out.append("U")
    out.append("*END STEP")
