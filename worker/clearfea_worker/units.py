# SPDX-License-Identifier: AGPL-3.0-or-later
"""Unit conversion from the single table in packages/spec/units.json (ARCHITECTURE.md section 5).

Physics-critical: the deck generator converts every entered quantity to SI through this module.
A value in unit u converts to SI as value * factor + offset. No other module holds a factor.
"""

import json
from functools import cache
from pathlib import Path

from .spec.units_schema import UnitDefinition, UnitsTable

#: Location in a source checkout. The worker image does not contain it yet; see docs/PROGRESS.md.
DEFAULT_TABLE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "units.json"


class UnitError(ValueError):
    """A quantity kind or unit that the units table does not define."""


def load_table(path: Path = DEFAULT_TABLE) -> UnitsTable:
    """Reads and checks a units table. Each kind's SI unit must have factor 1 and no offset."""
    table = UnitsTable.model_validate(json.loads(path.read_text(encoding="utf-8")))
    for kind, entry in table.kinds.items():
        si = entry.units.get(entry.si)
        if si is None or si.factor != 1 or (si.offset or 0) != 0:
            raise UnitError(
                f"{path}: the {kind} SI unit {entry.si} must be listed with factor 1 and no offset."
            )
    return table


@cache
def default_table() -> UnitsTable:
    return load_table()


def _unit(kind: str, unit: str, table: UnitsTable) -> UnitDefinition:
    entry = table.kinds.get(kind)
    if entry is None:
        raise UnitError(
            f"'{kind}' is not a known quantity kind. Known kinds: {', '.join(table.kinds)}."
        )
    definition = entry.units.get(unit)
    if definition is None:
        raise UnitError(f"'{unit}' is not a {kind} unit. Use one of: {', '.join(entry.units)}.")
    return definition


def to_si(value: float, unit: str, kind: str, table: UnitsTable | None = None) -> float:
    """Converts a value entered in `unit` to the SI unit of `kind`."""
    definition = _unit(kind, unit, table or default_table())
    return value * definition.factor + (definition.offset or 0.0)


def from_si(value: float, unit: str, kind: str, table: UnitsTable | None = None) -> float:
    """Converts a value in the SI unit of `kind` to `unit`."""
    definition = _unit(kind, unit, table or default_table())
    return (value - (definition.offset or 0.0)) / definition.factor
