# SPDX-License-Identifier: AGPL-3.0-or-later
"""Values printed in the report's own unit system (PLAN M7.6, ADR-076).

A report prints every value in the one unit system its author chose for it, whatever the browser
showed: results are stored in SI and setup values as typed (ARCHITECTURE section 5), so both are
converted here through clearfea_worker.units, the single conversion module. A setup value typed
in another unit also prints as entered, so a reviewer can trace it to the setup. Numbers carry
four significant figures, as the app shows them. Pure: no I/O beyond reading the units table.
"""

import math
from dataclasses import dataclass

from ..spec.simulation_schema import Quantity
from ..spec.units_schema import UnitsTable
from ..units import UnitError, default_table, from_si, to_si

#: Significant figures of every printed value, as the app shows results (RunPanel, Viewer).
SIGNIFICANT_FIGURES = 4

#: The unit of a ratio (the safety factor): printed as a bare number.
DIMENSIONLESS = "1"


def format_number(value: float, digits: int = SIGNIFICANT_FIGURES) -> str:
    """A number rounded to `digits` significant figures, written without trailing zeros.

    Plain decimals from 1e-6 up to 1e15, so stresses in Pa or psi and strains in m/m read
    without exponents; outside that, `1.235e-07` style. Minus zero prints as 0.
    """
    if not math.isfinite(value):
        raise ValueError(f"{value} cannot be printed in a report.")
    if value == 0:
        return "0"
    rounded = float(f"{value:.{digits - 1}e}")
    size = abs(rounded)
    if 1e-6 <= size < 1e15:
        decimals = max(digits - 1 - math.floor(math.log10(size)), 0)
        text = f"{rounded:.{decimals}f}"
        return text.rstrip("0").rstrip(".") if "." in text else text
    mantissa, exponent = f"{rounded:.{digits - 1}e}".split("e")
    if "." in mantissa:
        mantissa = mantissa.rstrip("0").rstrip(".")
    return f"{mantissa}e{exponent}"


def _with_unit(number: str, unit: str) -> str:
    return number if unit == DIMENSIONLESS else f"{number} {unit}"


@dataclass(frozen=True)
class ReportUnits:
    """The unit system a report prints in: one unit per quantity kind from units.json."""

    system: str
    table: UnitsTable

    @classmethod
    def of(cls, system: str, table: UnitsTable | None = None) -> "ReportUnits":
        """The report units of a system id; an id units.json does not list is refused."""
        table = table or default_table()
        if system not in table.systems:
            raise UnitError(
                f"'{system}' is not a unit system. Use one of: {', '.join(table.systems)}."
            )
        return cls(system, table)

    @property
    def name(self) -> str:
        """The system's name as the report states it, for example "US (in, lbf, psi)"."""
        return self.table.systems[self.system].name

    def unit(self, kind: str) -> str:
        """The unit the report prints a kind in."""
        unit = self.table.systems[self.system].units.get(kind)
        if unit is None:
            raise UnitError(f"'{kind}' is not a known quantity kind.")
        return unit

    def units(self, kinds: list[str]) -> list[tuple[str, str]]:
        """(kind, unit) for each kind, in the order given: the report's table of units."""
        return [(kind, self.unit(kind)) for kind in kinds]

    def value(self, si: float, kind: str) -> float:
        """A value stored in SI (a result) in the report's unit of its kind."""
        return from_si(si, self.unit(kind), kind, self.table)

    def quantity_value(self, quantity: Quantity, kind: str) -> float:
        """A value as the user typed it (a setup value) in the report's unit of its kind."""
        if quantity.unit == self.unit(kind):
            return quantity.value
        return self.value(to_si(quantity.value, quantity.unit, kind, self.table), kind)

    def text(self, si: float, kind: str) -> str:
        """A result as printed: "1.234 MPa"; a ratio has no unit."""
        return _with_unit(format_number(self.value(si, kind)), self.unit(kind))

    def vector_text(self, si: list[float], kind: str) -> str:
        """A vector or position as printed: "(1, 2.5, 0) mm"."""
        numbers = ", ".join(format_number(self.value(v, kind)) for v in si)
        return _with_unit(f"({numbers})", self.unit(kind))

    def quantity_text(self, quantity: Quantity, kind: str) -> str:
        """A setup value as printed: in the report's unit and, when typed in another unit,
        followed by the value as entered: "1450 psi (entered as 10 MPa)"."""
        unit = self.unit(kind)
        printed = _with_unit(format_number(self.quantity_value(quantity, kind)), unit)
        if quantity.unit == unit:
            return printed
        entered = _with_unit(format_number(quantity.value), quantity.unit)
        return f"{printed} (entered as {entered})"
