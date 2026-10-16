# SPDX-License-Identifier: AGPL-3.0-or-later
"""Safety factor against yield (M3.5, ADR-054): yield strength over von Mises at every node."""

from pathlib import Path

import pytest

from clearfea_worker.results import read_results, write_viewer_files
from clearfea_worker.results.fields import von_mises_field
from clearfea_worker.results.safety import (
    CAP,
    node_yield_strengths,
    safety_factor,
    yield_strengths,
)
from clearfea_worker.results.surface import read_fields as read_viewer_fields
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import two_tets
from .test_deck import fixture_spec

SOLVE = Path(__file__).resolve().parent / "fixtures" / "solve"


def with_yield(spec: dict, value: float = 250, unit: str = "MPa") -> dict:
    for material in spec["materials"]:
        material["yieldStrength"] = {"value": value, "unit": unit}
    return spec


def test_safety_factor_is_yield_over_von_mises_up_to_the_cap() -> None:
    assert safety_factor(250e6, 100e6) == pytest.approx(2.5)
    assert safety_factor(250e6, 500e6) == pytest.approx(0.5)
    assert safety_factor(250e6, 250e6 / CAP) == CAP
    assert safety_factor(250e6, 250e6 / 20) == CAP
    assert safety_factor(250e6, 0.0) == CAP


def test_yield_strengths_are_converted_to_pascals_per_body() -> None:
    spec = SimulationSpec.model_validate(with_yield(fixture_spec(), 36, "ksi"))
    assert yield_strengths(spec) == {1: pytest.approx(36e3 * 6894.757293168361)}


def test_no_safety_factor_unless_every_material_has_a_yield_strength() -> None:
    assert yield_strengths(SimulationSpec.model_validate(fixture_spec())) is None
    spec = with_yield(fixture_spec())
    spec["materials"][0]["yieldStrength"] = None
    assert yield_strengths(SimulationSpec.model_validate(spec)) is None


def test_a_node_shared_by_two_bodies_takes_the_smaller_yield_strength() -> None:
    mesh = two_tets(order=2, bodies=2)
    strengths = node_yield_strengths(mesh, {1: 300e6, 2: 200e6})
    # Element 0 (body 1) has corner 0 to itself, element 1 (body 2) corner 4; corners 1, 2
    # and 3 and the mid-edge nodes of their shared face belong to both.
    assert strengths[0] == 300e6
    assert strengths[4] == 200e6
    assert [strengths[n] for n in (1, 2, 3)] == [200e6] * 3


def test_results_carry_the_safety_factor_field_and_its_smallest_value(tmp_path: Path) -> None:
    # The fixture's von Mises stress runs from 1.3 to 3.9 MPa, so 10 MPa keeps every factor
    # below the cap.
    spec = SimulationSpec.model_validate(with_yield(fixture_spec(), 10))
    mesh = two_tets(order=2)
    fields, result = read_results(spec, mesh, SOLVE / "job.frd", SOLVE / "job.dat", "2.21")
    mises = von_mises_field(fields)
    assert fields.safety_factor is not None
    assert list(fields.safety_factor) == pytest.approx([10e6 / m for m in mises])
    # The smallest factor is where von Mises is largest: node 1 (index 0) at the origin.
    assert result.safety_factor is not None
    assert result.safety_factor.min.node == result.von_mises.max.node == 0
    assert result.safety_factor.min.value == pytest.approx(10e6 / result.von_mises.max.value)
    assert result.safety_factor.min.position == [0.0, 0.0, 0.0]
    viewer = write_viewer_files(mesh, fields, tmp_path)
    for path, count in ((viewer.fields_path, None), (viewer.nodes_path, mesh.node_count)):
        vertices, written = read_viewer_fields(path)
        assert count is None or vertices == count
        (factor,) = [f for f in written if f.name == "safetyFactor"]
        assert (factor.kind, factor.components, len(factor.values)) == ("ratio", 1, vertices)
        assert [f.name for f in written][-1] == "safetyFactor"
    _, nodes = read_viewer_fields(viewer.nodes_path)
    (factor,) = [f for f in nodes if f.name == "safetyFactor"]
    assert list(factor.values) == pytest.approx(list(fields.safety_factor), rel=1e-6)


def test_results_without_yield_strength_have_no_safety_factor(tmp_path: Path) -> None:
    spec = SimulationSpec.model_validate(fixture_spec())
    mesh = two_tets(order=2)
    fields, result = read_results(spec, mesh, SOLVE / "job.frd", SOLVE / "job.dat", "2.21")
    assert fields.safety_factor is None and result.safety_factor is None
    assert "safetyFactor" not in result.model_dump(by_alias=True, exclude_none=True)
    viewer = write_viewer_files(mesh, fields, tmp_path)
    _, written = read_viewer_fields(viewer.fields_path)
    assert "safetyFactor" not in [f.name for f in written]
