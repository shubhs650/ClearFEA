# SPDX-License-Identifier: AGPL-3.0-or-later
"""Pressure: a uniform pressure on each element face of the loaded faces (*DLOAD, Pn).

A positive pressure in the spec pushes on the face towards the body (ADR-026 item 4). A
positive CalculiX pressure acts the same way, against the element face's outward normal, so
the value is written unchanged; the deck check in ADR-029 shows this by solving.
"""

from ...meshing.volume import VolumeMesh
from ..elements import CCX_FACE_NUMBER


def pressure_faces(mesh: VolumeMesh, faces: list[int]) -> list[tuple[int, int]]:
    """The (0-based element, CalculiX face number) pairs that make up ``faces``."""
    return [
        (element, CCX_FACE_NUMBER[local]) for tag in faces for element, local in mesh.faces[tag]
    ]
