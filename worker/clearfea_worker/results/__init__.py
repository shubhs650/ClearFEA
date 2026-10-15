# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction: CalculiX .frd and .dat -> nodal fields and a summary (physics-critical)."""

from .dat import DatError, read_reaction_totals
from .fields import NodalFields, read_fields, von_mises
from .frd import FrdError
from .summary import read_results, summarize

__all__ = [
    "DatError",
    "FrdError",
    "NodalFields",
    "read_fields",
    "read_reaction_totals",
    "read_results",
    "summarize",
    "von_mises",
]
