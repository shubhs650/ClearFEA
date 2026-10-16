# SPDX-License-Identifier: AGPL-3.0-or-later
"""Material properties that vary with temperature (M5.5, ADR-068).

Physics-critical. A property table is rows of a temperature and a value; between rows CalculiX
interpolates linearly, and below the first row and above the last it uses the first and last
value (checked with ccx 2.21 on a bar with a conductivity table that stopped short of the
bar's temperatures: the heat flow was the clamped integral, 35 W, not the extrapolated 40 W).
Only steady-state thermal and thermal stress analyses use the tables, since only they know each
node's absolute temperature; a linear static analysis uses the single values.

CalculiX wants Young's modulus and Poisson's ratio on the same rows (*ELASTIC), so where only
one of them varies, or both at different temperatures, the rows are merged here at every
temperature of either, each value interpolated the way CalculiX would. Within the tables'
range that changes nothing, since both are piecewise linear with breaks only at their own
rows; outside it both are constant either way.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from ..spec.simulation_schema import ExpansionTable, PropertyTable, Quantity
from .common import DeckError, si


@dataclass(frozen=True)
class Table:
    """A property against temperature in SI: (kelvin, value) points in rising temperature."""

    points: tuple[tuple[float, float], ...]

    def at(self, kelvin: float) -> float:
        """The value at ``kelvin``: linear between points, the end values beyond them."""
        first, last = self.points[0], self.points[-1]
        if kelvin <= first[0]:
            return first[1]
        if kelvin >= last[0]:
            return last[1]
        for (t0, v0), (t1, v1) in zip(self.points, self.points[1:], strict=False):
            if kelvin <= t1:
                return v0 + (v1 - v0) * (kelvin - t0) / (t1 - t0)
        return last[1]  # pragma: no cover - the loop returns before

    @property
    def largest(self) -> float:
        return max(v for _, v in self.points)


#: A property's value: one number, or a table against temperature.
type Property = float | Table


def table(
    entered: PropertyTable | ExpansionTable,
    kind: str | None,
    what: str,
    check: Callable[[float], str | None] = lambda _: None,
) -> Table:
    """The SI table of ``entered``, a property of ``kind`` (None for a dimensionless one).

    DeckError naming ``what`` when a row is incomplete, there are fewer than two rows, the
    temperatures do not rise or are at or below absolute zero, a unit is of the wrong kind, or
    ``check`` finds a value wrong (it returns what is wrong with an SI value, or None).
    """
    rows = entered.rows
    if len(rows) < 2:
        raise DeckError(
            f"{what} has {len(rows)} row{'' if len(rows) == 1 else 's'}. A table needs at "
            "least two; add a row, or delete the table and enter one value."
        )
    points = []
    for n, row in enumerate(rows, start=1):
        if row.temperature is None or row.value is None:
            raise DeckError(f"{what}: row {n} is not complete. Fill it in, or delete the row.")
        kelvin = si(
            Quantity(value=row.temperature, unit=entered.temperature_unit),
            "temperature",
            f"{what}: row {n} temperature",
        )
        if kelvin <= 0.0:
            raise DeckError(f"{what}: row {n} is at or below absolute zero. Enter a temperature.")
        if kind is None:
            if entered.unit is not None:
                raise DeckError(f"{what} has a unit, {entered.unit}; it has none. Remove it.")
            value = row.value
        else:
            value = si(Quantity(value=row.value, unit=entered.unit or ""), kind, f"{what}: row {n}")
        problem = check(value)
        if problem is not None:
            raise DeckError(f"{what}: row {n} {problem}.")
        if points and kelvin <= points[-1][0]:
            raise DeckError(
                f"{what}: row {n} is not hotter than row {n - 1}. List the rows in rising "
                "temperature, each temperature once."
            )
        points.append((kelvin, value))
    return Table(tuple(points))


def expansion_reference(entered: ExpansionTable, what: str) -> float:
    """The temperature (K) the mean coefficients of an expansion table are measured from."""
    kelvin = si(entered.reference_temperature, "temperature", f"{what}: reference temperature")
    if kelvin <= 0.0:
        raise DeckError(f"{what}: the reference temperature is at or below absolute zero.")
    return kelvin


def rows(properties: Sequence[Property]) -> list[tuple[float | None, list[float]]]:
    """Data rows for a keyword whose line holds several properties and a temperature: one row
    (None, values) when none varies, else a row at every temperature of any table."""
    temperatures = sorted({t for p in properties if isinstance(p, Table) for t, _ in p.points})
    if not temperatures:
        return [(None, [p for p in properties if not isinstance(p, Table)])]
    return [(t, [p.at(t) if isinstance(p, Table) else p for p in properties]) for t in temperatures]


def positive(value: float) -> str | None:
    return None if value > 0.0 else "must be greater than zero"


def poisson(value: float) -> str | None:
    return None if -1.0 < value < 0.5 else "must be between -1 and 0.5"
