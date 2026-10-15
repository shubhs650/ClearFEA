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
from ..spec.simulation_schema import Quantity, SimulationSpec
from ..units import UnitError, to_si
from .elements import CCX_NODE_ORDER, ELEMENT_TYPE
from .loads import fixed_support_nodes, pressure_faces

#: Version of the deck layout below. Bump it when the text for the same inputs changes.
DECK_FORMAT = 1

#: CalculiX reads at most 16 entries on a data line.
_PER_LINE = 16


class DeckError(ValueError):
    """The spec cannot be turned into solver input. The message says what to change."""


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


def _si(quantity: Quantity | None, kind: str, what: str) -> float:
    if quantity is None:
        raise DeckError(f"{what} has no value. Enter one before running.")
    try:
        return to_si(quantity.value, quantity.unit, kind)
    except UnitError as error:
        raise DeckError(f"{what}: {error}") from None


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
    for support, name in zip(spec.supports, support_sets, strict=True):
        out.append(
            f'** Fixed support {support.id} "{_label(support.name)}", faces '
            + ", ".join(str(f) for f in support.faces)
        )
        out.append(f"*NSET, NSET={name}")
        out.extend(_lines(n + 1 for n in fixed_support_nodes(mesh, support.faces)))

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
    out.extend(f"{name}, 1, 3" for name in support_sets)
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
    for name in support_sets:
        out.append(f"*NODE PRINT, NSET={name}, TOTALS=ONLY")
        out.append("RF")
    out.append("*END STEP")
    return "\n".join(out) + "\n"
