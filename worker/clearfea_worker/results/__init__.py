# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction: CalculiX .frd and .dat -> nodal fields and a summary (physics-critical)."""

from .dat import DatError, read_node_displacements, read_node_forces, read_reaction_totals
from .fields import NodalFields, read_fields, von_mises
from .frd import FrdError
from .summary import read_results, summarize
from .surface import extract_surface, surface_fields, write_viewer_files

__all__ = [
    "DatError",
    "extract_surface",
    "surface_fields",
    "write_viewer_files",
    "FrdError",
    "NodalFields",
    "read_fields",
    "read_node_displacements",
    "read_node_forces",
    "read_reaction_totals",
    "read_results",
    "summarize",
    "von_mises",
]
