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
from ..spec.simulation_schema import FixedSupport, PrescribedDisplacement, SimulationSpec
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
from .loads import fixed_support_nodes, pressure_faces

#: Version of the deck layout below. Bump it when the text for the same inputs changes.
DECK_FORMAT = 1

#: CalculiX reads at most 16 entries on a data line.
_PER_LINE = 16

#: The node set whose reaction forces are printed node by node when a setup has supports other
#: than fixed ones; the result reader shares them between supports (constraints.py).
REACTION_SET = "RALL"

__all__ = ["DECK_FORMAT", "DeckError", "REACTION_SET", "generate_deck", "support_set_names"]


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
    """True when every support is fixed: the deck then holds each support's node set in all
    three directions and prints its total reaction (the M1 layout, ADR-029). Otherwise nodes
    are held through constraint groups and reactions are printed node by node (ADR-039)."""
    return all(isinstance(s, FixedSupport) for s in spec.supports)


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


def generate_deck(spec: SimulationSpec, mesh: VolumeMesh) -> str:
    """CalculiX input for a linear static analysis of ``spec`` on ``mesh``.

    Raises DeckError when the spec is incomplete or does not fit the mesh.
    """
    if spec.analysis != "linear_static":
        raise DeckError(f"Analysis type '{spec.analysis}' is not supported.")
    if not spec.supports:
        raise DeckError("The setup has no supports, so the part is free to move. Add a support.")
    for item in (*spec.supports, *spec.loads):
        _check_faces(mesh, item.faces, f"{item.name}")
    bodies = _materials(spec, mesh)

    npe = NODES_PER_ELEMENT[mesh.order]
    used = set(mesh.elements)
    if len(used) != mesh.node_count:
        raise DeckError(
            f"The mesh has {mesh.node_count - len(used)} nodes that belong to no element. "
            "Mesh the simulation again."
        )
    held = holds(spec, mesh)
    check_held(mesh, held)
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
        if isinstance(support, PrescribedDisplacement):
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
    if not fixed_only:
        out.append(f"*NSET, NSET={REACTION_SET}")
        out.extend(_lines(n + 1 for n in held))

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
    for tag, _, name in bodies:
        out.append(f"*SOLID SECTION, ELSET=B{tag}, MATERIAL={name}")

    # Pressures on the same element face add up (linear analysis), so each face gets one line.
    pressure: dict[tuple[int, int], float] = {}
    for load in spec.loads:
        value = _si(load.magnitude, "pressure", f"{load.name}: magnitude")
        entered = load.magnitude
        assert entered is not None  # _si refuses a missing magnitude
        out.append(
            f'** Pressure {load.id} "{_label(load.name)}", faces '
            + ", ".join(str(f) for f in load.faces)
            + f": {_number(entered.value)} {entered.unit} = {_number(value)} Pa"
        )
        for key in pressure_faces(mesh, load.faces):
            pressure[key] = pressure.get(key, 0.0) + value

    out.append("*STEP")
    out.append("*STATIC")
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
    out.append("*NODE FILE")
    out.append("U")
    out.append("*EL FILE")
    out.append("S")
    if fixed_only:
        for name in support_sets:
            out.append(f"*NODE PRINT, NSET={name}, TOTALS=ONLY")
            out.append("RF")
    else:
        # Node by node, in global axes (a transformed node's forces are otherwise printed in
        # its own axes; checked with ccx 2.21).
        out.append(f"*NODE PRINT, NSET={REACTION_SET}, GLOBAL=YES")
        out.append("RF")
    out.append("*END STEP")
    return "\n".join(out) + "\n"
