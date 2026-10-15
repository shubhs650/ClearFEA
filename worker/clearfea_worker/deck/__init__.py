# SPDX-License-Identifier: AGPL-3.0-or-later
"""Deck generator: SimulationSpec + volume mesh -> CalculiX input (physics-critical)."""

from .generator import DECK_FORMAT, DeckError, generate_deck

__all__ = ["DECK_FORMAT", "DeckError", "generate_deck"]
