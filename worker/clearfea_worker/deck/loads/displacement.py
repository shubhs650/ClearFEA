# SPDX-License-Identifier: AGPL-3.0-or-later
"""Prescribed displacement: the faces' nodes moved by given global x, y, z components (M2.2).

A component of zero holds the nodes in that direction; a free one is left to the solution.
Values are converted to metres here, the only place the entered components are read.
"""

from ...spec.simulation_schema import PrescribedDisplacement, Quantity
from ..common import DeckError, si


def prescribed_components(support: PrescribedDisplacement) -> list[tuple[int, float]]:
    """(axis 0-2, displacement in metres) of each component that is not free."""
    what = f'Prescribed displacement "{support.name}"'
    held = []
    for axis, component in enumerate((support.x, support.y, support.z)):
        name = "xyz"[axis]
        if component == "free":
            continue
        if component is None:
            raise DeckError(f"{what}: the {name} component has no value. Enter one or set it free.")
        assert isinstance(component, Quantity)
        held.append((axis, si(component, "length", f"{what}: {name} component")))
    if not held:
        raise DeckError(
            f"{what} leaves every component free, so it holds nothing. Give at least one "
            "component a value (0 holds the faces in that direction)."
        )
    return held
