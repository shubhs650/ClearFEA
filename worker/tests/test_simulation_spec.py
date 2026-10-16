# SPDX-License-Identifier: AGPL-3.0-or-later
"""The worker reads the same SimulationSpec the API stores (packages/spec, ADR-026)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from clearfea_worker.spec.simulation_schema import SimulationSpec

FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "fixtures"


def fixture() -> dict:
    return json.loads((FIXTURE / "simulation-v1.json").read_text())


def test_fixture_parses_with_quantities_as_typed() -> None:
    spec = SimulationSpec.model_validate(fixture())
    assert spec.geometry_id == "00000000-0000-4000-8000-000000000001"
    material = spec.materials[0]
    assert material.youngs_modulus is not None
    assert (material.youngs_modulus.value, material.youngs_modulus.unit) == (200, "GPa")
    assert material.poissons_ratio == 0.3
    assert spec.loads[0].faces == [2, 3]
    assert spec.mesh.size is not None and spec.mesh.size.unit == "mm"


def test_round_trip_keeps_wire_names() -> None:
    spec = SimulationSpec.model_validate(fixture())
    # exclude_unset: optional fields the fixture leaves out (density, M2.3) stay out.
    assert json.loads(spec.model_dump_json(by_alias=True, exclude_unset=True)) == fixture()


@pytest.mark.parametrize(
    "change",
    [
        lambda s: s.update(version=2),
        lambda s: s.update(solver="pardiso"),
        lambda s: s["materials"][0].update(poissonsRatio=0.5),
        lambda s: s["loads"][0].update(type="force"),
    ],
)
def test_refuses_what_the_schema_refuses(change) -> None:
    spec = fixture()
    change(spec)
    with pytest.raises(ValidationError):
        SimulationSpec.model_validate(spec)
