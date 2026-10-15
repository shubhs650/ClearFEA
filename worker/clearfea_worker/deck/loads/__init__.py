# SPDX-License-Identifier: AGPL-3.0-or-later
"""Translation of each support and load type into CalculiX input (physics-critical)."""

from .displacement import prescribed_components
from .fixed import fixed_support_nodes
from .frictionless import face_normal
from .pressure import pressure_faces

__all__ = ["face_normal", "fixed_support_nodes", "prescribed_components", "pressure_faces"]
