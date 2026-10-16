# SPDX-License-Identifier: AGPL-3.0-or-later
"""Deck generator: SimulationSpec + volume mesh -> CalculiX input (physics-critical)."""

from .generator import (
    DECK_FORMAT,
    EXCHANGE_SET,
    HEAT_SET,
    HEAT_TIE_SET,
    REACTION_SET,
    TIE_SET,
    DeckError,
    generate_deck,
    only_fixed_supports,
    support_set_names,
)

__all__ = [
    "DECK_FORMAT",
    "EXCHANGE_SET",
    "HEAT_SET",
    "HEAT_TIE_SET",
    "REACTION_SET",
    "TIE_SET",
    "DeckError",
    "generate_deck",
    "only_fixed_supports",
    "support_set_names",
]
