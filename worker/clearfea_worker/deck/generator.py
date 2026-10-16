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

from ..meshing.volume import NODES_PER_ELEMENT, VolumeMesh
from ..spec.simulation_schema import (
    CentrifugalLoad,
    ElasticSupport,
    FixedSupport,
    ForceLoad,
    GravityLoad,
    HydrostaticLoad,
    PrescribedDisplacement,
    PressureLoad,
    Quantity,
    RemoteLoad,
    SimulationSpec,
    TemperatureLoad,
)
from .applied import force_loads
from .common import DeckError, si
from .constraints import (
    AXES,
    Hold,
    check_held,
    frictionless_normals,
    holds,
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
)
from .loads.body import gravity_vector, rotation
from .loads.thermal import expansions, temperature_change

#: Version of the deck layout below. Bump it when the text for the same inputs changes.
DECK_FORMAT = 4

#: CalculiX reads at most 16 entries on a data line.
_PER_LINE = 16

#: The node set of every held node, whose reaction forces are printed node by node; the result
#: reader shares them between supports (constraints.py) and takes their moments (M3.2).
REACTION_SET = "RALL"

__all__ = [
    "DECK_FORMAT",
    "DeckError",
    "REACTION_SET",
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


def _perpendicular(a: tuple[float, float, float]) -> tuple[float, float, float]:
    """A unit vector at right angles to unit vector ``a``, the same for the same ``a``."""
    axis = min(range(3), key=lambda i: (abs(a[i]), i))
    e = AXES[axis]
    d = sum(a[i] * e[i] for i in range(3))
    v = [e[i] - d * a[i] for i in range(3)]
    length = sum(x * x for x in v) ** 0.5
    return (v[0] / length, v[1] / length, v[2] / length)


def _vector(v: Iterable[float]) -> str:
    return ", ".join(_number(x + 0.0) for x in v)


def _entered(*quantities: Quantity | None) -> str:
    """Components as the user entered them, for a deck comment; callers have checked them."""
    return ", ".join(f"{_number(q.value)} {q.unit}" for q in quantities if q is not None)


def _hold_lines(h: Hold) -> tuple[str | None, "_Dofs"]:
    """How a node's Hold is written: the *TRANSFORM data line or None (global axes), and the
    (degree of freedom, value or None for zero) to hold in that system. Values below 1e-12 of
    the node's largest are rounding left by the solve and written as zero."""
    size = max((abs(v) for v in h.values), default=0.0)

    def value(v: float) -> str | None:
        return None if abs(v) <= 1e-12 * size else _number(v)

    if h.on_axes or len(h.basis) == 3:
        u = h.displacement()
        held = [0, 1, 2]
        if len(h.basis) < 3:
            held = sorted({max(range(3), key=lambda i: abs(q[i])) for q in h.basis})
        return None, [(i + 1, value(u[i])) for i in held]
    a = h.basis[0]
    b = h.basis[1] if len(h.basis) == 2 else _perpendicular(a)
    return f"{_vector(a)}, {_vector(b)}", [(k + 1, value(v)) for k, v in enumerate(h.values)]


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


#: CalculiX's name for each equation solver a spec may choose (ADR-058). Every deck names its
#: solver on the ``*STATIC`` line, so the deck alone says what solved it, whatever the build's
#: default.
SOLVER_NAMES = {
    "pastix": "PASTIX",
    "spooles": "SPOOLES",
    "iterative_cholesky": "ITERATIVE CHOLESKY",
    "iterative_scaling": "ITERATIVE SCALING",
}
#: The solver of a spec saved before ADR-058, which has none.
DEFAULT_SOLVER = "pastix"
#: Equation solvers a deck may name (M2.11, ADR-048).
SOLVERS = tuple(SOLVER_NAMES.values())


def generate_deck(spec: SimulationSpec, mesh: VolumeMesh, *, solver: str | None = None) -> str:
    """CalculiX input for a linear static analysis of ``spec`` on ``mesh``.

    The ``*STATIC`` line names the spec's equation solver (ADR-058); ``solver``, a CalculiX
    name from SOLVERS, replaces it for the solver benchmark (M2.11). Raises DeckError when the
    spec is incomplete or does not fit the mesh.
    """
    if solver is None:
        solver = SOLVER_NAMES[spec.solver or DEFAULT_SOLVER]
    elif solver not in SOLVERS:
        raise DeckError(f"Unknown equation solver '{solver}'.")
    if spec.analysis != "linear_static":
        raise DeckError(f"Analysis type '{spec.analysis}' is not supported.")
    if not spec.supports:
        raise DeckError("The setup has no supports, so the part is free to move. Add a support.")
    for item in (*spec.supports, *spec.loads):
        if not isinstance(item, (GravityLoad, CentrifugalLoad, TemperatureLoad)):
            _check_faces(mesh, item.faces, f"{item.name}")
    bodies = _materials(spec, mesh)
    gravity, spin = body_loads(spec)
    if gravity is not None or spin is not None:
        densities(spec, mesh)  # body loads need every body's density; DeckError names a gap
    thermal = temperature_change(spec)
    alpha = {} if thermal is None else expansions(spec, mesh)

    npe = NODES_PER_ELEMENT[mesh.order]
    used = set(mesh.elements)
    if len(used) != mesh.node_count:
        raise DeckError(
            f"The mesh has {mesh.node_count - len(used)} nodes that belong to no element. "
            "Mesh the simulation again."
        )
    held = holds(spec, mesh)
    springs = _elastic_springs(spec, mesh)
    check_held(mesh, held, [s for _, group in springs for s in group])
    fixed_only = only_fixed_supports(spec)
    normals = {} if fixed_only else frictionless_normals(spec, mesh)

    out = [
        f"** ClearFEA solver input, deck format {DECK_FORMAT}. Generated from the simulation's",
        "** setup and mesh; do not edit. Units: SI (m, kg, s, N, Pa).",
        f"** Geometry {spec.geometry_id}",
        "*HEADING",
        "ClearFEA linear static analysis",
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

    support_sets = support_set_names(spec)
    fixed_nodes: set[int] = set()
    for support, name in zip(spec.supports, support_sets, strict=True):
        nodes = fixed_support_nodes(mesh, support.faces)
        line = (
            f'** {support_kind(support)} {support.id} "{_label(support.name)}", faces '
            + ", ".join(str(f) for f in support.faces)
        )
        if isinstance(support, ElasticSupport):
            k = elastic_stiffness(support)
            assert support.stiffness is not None  # elastic_stiffness refuses a missing one
            line += (
                f": foundation stiffness {_number(support.stiffness.value)} "
                f"{support.stiffness.unit} = {_number(k)} N/m^3"
            )
        elif isinstance(support, PrescribedDisplacement):
            parts = []
            for axis, component in zip("xyz", (support.x, support.y, support.z), strict=True):
                if component == "free" or component is None:
                    parts.append(f"{axis} free")
                else:
                    value = _si(component, "length", f"{support.name}: {axis} component")
                    parts.append(
                        f"{axis} {_number(component.value)} {component.unit} = {_number(value)} m"
                    )
            line += ": " + ", ".join(parts)
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
    if held:
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
            out.append(f"{key}, {_vector(_perpendicular(d))}")

    for k, material in enumerate(spec.materials):
        if not any(index == k for _, index, _ in bodies):
            continue
        what = f"Material {material.name}"
        modulus = _si(material.youngs_modulus, "pressure", f"{what}: Young's modulus")
        if modulus <= 0:
            raise DeckError(f"{what}: Young's modulus must be greater than zero.")
        if material.poissons_ratio is None:
            raise DeckError(f"{what}: Poisson's ratio has no value. Enter one before running.")
        out.append(f'** Material {material.id} "{_label(material.name)}"')
        out.append(f"*MATERIAL, NAME=M{k + 1}")
        out.append("*ELASTIC")
        out.append(f"{_number(modulus)}, {_number(material.poissons_ratio)}")
        if material.density is not None:
            rho = _si(material.density, "density", f"{what}: density")
            if rho <= 0:
                raise DeckError(f"{what}: the density must be greater than zero.")
            out.append(f"** Density {_number(material.density.value)} {material.density.unit}")
            out.append("*DENSITY")
            out.append(_number(rho))
        if material.id in alpha:
            entered = material.thermal_expansion
            assert entered is not None  # expansions() refuses a missing one
            out.append(f"** Thermal expansion {_number(entered.value)} {entered.unit}")
            out.append("*EXPANSION")
            out.append(_number(alpha[material.id]))
    for tag, _, name in bodies:
        out.append(f"*SOLID SECTION, ELSET=B{tag}, MATERIAL={name}")
    for j, (key, stiffness) in enumerate(spring_sets):
        name, dof, _ = directions[key]
        out.append(f"*SPRING, ELSET=K{j + 1}" + ("" if name is None else f", ORIENTATION={name}"))
        out.append(str(dof))
        out.append(stiffness)

    for load in spec.loads:
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
        out.append("*INITIAL CONDITIONS, TYPE=TEMPERATURE")
        out.append("NALL, 0.0")

    out.append("*STEP")
    out.append(f"*STATIC, SOLVER={solver}")
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
    out.append("*END STEP")
    return "\n".join(out) + "\n"
