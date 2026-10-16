# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction: CalculiX .frd and .dat -> nodal fields and a summary (physics-critical)."""

from .dat import DatError, read_node_displacements, read_node_forces
from .fields import (
    NodalFields,
    ThermalFields,
    principal_stresses,
    read_fields,
    read_thermal_fields,
    von_mises,
)
from .frd import FrdError
from .modal import ModalFields, read_eigenvalues
from .summary import read_results, summarize
from .surface import extract_surface, node_fields, surface_fields, write_viewer_files

__all__ = [
    "DatError",
    "extract_surface",
    "node_fields",
    "surface_fields",
    "write_viewer_files",
    "FrdError",
    "ModalFields",
    "NodalFields",
    "ThermalFields",
    "principal_stresses",
    "read_eigenvalues",
    "read_fields",
    "read_thermal_fields",
    "read_node_displacements",
    "read_node_forces",
    "read_results",
    "summarize",
    "von_mises",
]
