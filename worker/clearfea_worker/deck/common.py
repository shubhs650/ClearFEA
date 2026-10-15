# SPDX-License-Identifier: AGPL-3.0-or-later
"""What the deck generator and its load translations share: the refusal and SI conversion."""

from ..spec.simulation_schema import Quantity
from ..units import UnitError, to_si


class DeckError(ValueError):
    """The spec cannot be turned into solver input. The message says what to change."""


def si(quantity: Quantity | None, kind: str, what: str) -> float:
    """``quantity`` in SI, or DeckError naming ``what`` when it is missing or of the wrong kind."""
    if quantity is None:
        raise DeckError(f"{what} has no value. Enter one before running.")
    try:
        return to_si(quantity.value, quantity.unit, kind)
    except UnitError as error:
        raise DeckError(f"{what}: {error}") from None
