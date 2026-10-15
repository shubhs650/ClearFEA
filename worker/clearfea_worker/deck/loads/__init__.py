# SPDX-License-Identifier: AGPL-3.0-or-later
"""Translation of each support and load type into CalculiX input (physics-critical)."""

from .fixed import fixed_support_nodes
from .pressure import pressure_faces

__all__ = ["fixed_support_nodes", "pressure_faces"]
