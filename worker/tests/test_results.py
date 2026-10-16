# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction from CalculiX output (no solver runs).

tests/fixtures/solve/ holds what CalculiX 2.21 wrote for the fixture-c3d10 deck snapshot
(tests/snapshots/deck/): two C3D10 elements, one fixed face, two pressed faces.
"""

import math
from pathlib import Path

import pytest

from clearfea_worker.deck.applied import NO_LOAD, Resultant, applied_nodal_loads, load_resultants
from clearfea_worker.deck.elements import FACE_NODES
from clearfea_worker.results import (
    DatError,
    FrdError,
    node_fields,
    principal_stresses,
    read_fields,
    read_node_displacements,
    read_node_forces,
    read_results,
    read_thermal_fields,
    von_mises,
    write_viewer_files,
)
from clearfea_worker.results.dat import read_node_heat_flows, read_node_temperatures
from clearfea_worker.results.heat import HeatFlow, heat_balance
from clearfea_worker.results.summary import Reaction, balance
from clearfea_worker.results.surface import read_fields as read_fields_file
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import bonded_tets, two_tets
from .test_deck import (
    elastic_spec,
    elastic_sym_spec,
    fixture_spec,
    heat_loads_spec,
    heat_two_bodies_spec,
    supports_spec,
    thermal_stress_spec,
)

SOLVE = Path(__file__).resolve().parent / "fixtures" / "solve"


def test_reads_displacement_and_stress_of_every_node() -> None:
    fields = read_fields(SOLVE / "job.frd", 14)
    assert fields.node_count == 14
    assert list(fields.displacement[0:3]) == [0.0, 0.0, 0.0]
    assert list(fields.displacement[12:15]) == [-3.34265e-07, 1.81991e-07, 1.93399e-07]
    assert list(fields.stress[0:6]) == [
        3.50955e06,
        1.50409e06,
        1.50410e06,
        -7.48315e04,
        -7.92396e-01,
        1.52217e06,
    ]
    # The total strain, EXX to EZX as the file lists them (M3.1).
    assert list(fields.strain[6:12]) == [
        2.41532e-06,
        1.89529e-06,
        -6.31506e-06,
        4.18122e-06,
        2.61273e-06,
        4.53690e-06,
    ]


def test_principal_stresses_of_known_stress_states() -> None:
    assert principal_stresses(-1.0e6, 0, 0, 0, 0, 0) == (0.0, 0.0, -1.0e6)
    assert principal_stresses(1.0, 3.0, 2.0, 0, 0, 0) == (3.0, 2.0, 1.0)
    # Pure shear in xy: +tau and -tau at 45 degrees, nothing along z.
    s1, s2, s3 = principal_stresses(0, 0, 0, 2.0e6, 0, 0)
    assert (s1, s2, s3) == pytest.approx((2.0e6, 0.0, -2.0e6), abs=1e-6)
    s1, s2, s3 = principal_stresses(0, 0, 0, 0, 0, -2.0e6)
    assert (s1, s2, s3) == pytest.approx((2.0e6, 0.0, -2.0e6), abs=1e-6)
    # Plane stress with shear: (sx + sy)/2 +- sqrt(((sx - sy)/2)^2 + txy^2).
    s1, s2, s3 = principal_stresses(80.0, 20.0, 0, 40.0, 0, 0)
    # Here 50 +- 50, and sz = 0 is the third.
    assert (s1, s2, s3) == pytest.approx((100.0, 0.0, 0.0), abs=1e-9)
    s1, s2, s3 = principal_stresses(80.0, 20.0, -30.0, 40.0, 0, 0)
    assert (s1, s2, s3) == pytest.approx((100.0, 0.0, -30.0), abs=1e-9)
    # A hydrostatic state, and one with a tiny shear, which splits it by plus and minus that.
    assert principal_stresses(5.0, 5.0, 5.0, 0, 0, 0) == (5.0, 5.0, 5.0)
    s = principal_stresses(5.0e6, 5.0e6, 5.0e6, 1e-3, 0, 0)
    assert s == pytest.approx((5.0e6 + 1e-3, 5.0e6, 5.0e6 - 1e-3), abs=1e-8)


@pytest.mark.parametrize("seed", range(20))
def test_principal_stresses_keep_the_invariants_of_the_tensor(seed: int) -> None:
    import random

    rng = random.Random(seed)
    sxx, syy, szz, sxy, syz, szx = (rng.uniform(-1e8, 1e8) for _ in range(6))
    s1, s2, s3 = principal_stresses(sxx, syy, szz, sxy, syz, szx)
    assert s1 >= s2 >= s3
    scale = 1e8
    # I1, I2 and I3 of the tensor equal those of its eigenvalues.
    i1 = sxx + syy + szz
    i2 = sxx * syy + syy * szz + szz * sxx - sxy**2 - syz**2 - szx**2
    i3 = sxx * syy * szz + 2 * sxy * syz * szx - sxx * syz**2 - syy * szx**2 - szz * sxy**2
    assert s1 + s2 + s3 == pytest.approx(i1, abs=1e-9 * scale)
    assert s1 * s2 + s2 * s3 + s3 * s1 == pytest.approx(i2, abs=1e-9 * scale**2)
    assert s1 * s2 * s3 == pytest.approx(i3, abs=1e-9 * scale**3)
    # Von Mises from the principal stresses equals von Mises from the components.
    assert von_mises(s1, s2, s3, 0, 0, 0) == pytest.approx(
        von_mises(sxx, syy, szz, sxy, syz, szx), rel=1e-9
    )


def test_von_mises_of_known_stress_states() -> None:
    assert von_mises(-1.0e6, 0, 0, 0, 0, 0) == pytest.approx(1.0e6)
    assert von_mises(0, 0, 0, 2.0e6, 0, 0) == pytest.approx(math.sqrt(3) * 2.0e6)
    assert von_mises(0, 0, 0, 0, 0, 2.0e6) == pytest.approx(math.sqrt(3) * 2.0e6)
    assert von_mises(5.0e6, 5.0e6, 5.0e6, 0, 0, 0) == pytest.approx(0.0, abs=1e-9)
    # Plane stress s1 = 100, s2 = 50: sqrt(s1^2 - s1 s2 + s2^2).
    assert von_mises(100.0, 50.0, 0, 0, 0, 0) == pytest.approx(math.sqrt(7500.0))


def test_reads_the_reaction_force_of_every_held_node() -> None:
    forces = read_node_forces(SOLVE / "job.dat", "RALL")
    # Face 1's corners and mid-edge nodes (1-based 1, 3, 4, 8, 9, 10).
    assert sorted(forces) == [0, 2, 3, 7, 8, 9]
    assert forces[9] == (1.053433e02, 1.509460e00, -5.888535e00)


def test_summary_names_the_extremes_and_the_reaction_of_each_support() -> None:
    spec = SimulationSpec.model_validate(fixture_spec())
    mesh = two_tets(order=2)
    _, result = read_results(spec, mesh, SOLVE / "job.frd", SOLVE / "job.dat", "2.21")
    # Node 5 (index 4, the corner at 10, 10, 10 mm) moves most.
    assert result.displacement.max.node == 4
    assert result.displacement.max.value == pytest.approx(
        math.sqrt(3.34265e-07**2 + 1.81991e-07**2 + 1.93399e-07**2)
    )
    assert result.displacement.max.position == [0.01, 0.01, 0.01]
    # Checked by hand from the file: node 1 (index 0, at the origin on the fixed face) has
    # the largest von Mises stress, node 12 (index 11) the smallest.
    assert result.von_mises.max.node == 0
    assert result.von_mises.max.value == pytest.approx(
        von_mises(3.50955e06, 1.50409e06, 1.50410e06, -7.48315e04, -7.92396e-01, 1.52217e06)
    )
    assert result.von_mises.max.position == [0.0, 0.0, 0.0]
    assert result.von_mises.min.node == 11
    assert result.von_mises.min.value == pytest.approx(1313414.807, rel=1e-9)
    assert [r.support_id for r in result.reactions] == ["fixed-1"]
    # The pressures add up to (-100, 0, 50) N; until M3.2 the part landing on the fixed
    # face's nodes was left in the reaction, which then read (100, 0, -33.3) N (ADR-051).
    assert [load.load_id for load in result.loads] == ["pressure-1"]
    assert result.loads[0].force == pytest.approx([-100.0, 0.0, 50.0], abs=1e-12)
    reaction = result.reactions[0]
    assert reaction.force == pytest.approx([100.0, 0.0, -50.0], abs=1e-4)
    # About the centroid of face 1, the triangle (0, 0, 0), (0, 10, 0), (0, 0, 10) mm.
    assert reaction.point == pytest.approx([0.0, 0.01 / 3, 0.01 / 3], abs=1e-15)
    assert reaction.moment == pytest.approx([0.0, 1 / 3, -1 / 6], abs=1e-6)
    # Balanced to the solver's printed digits.
    balance = result.balance
    assert balance is not None
    assert balance.force_ratio < 1e-6 and balance.moment_ratio < 1e-6
    # Measured against the pressures' gross size, the sum of their nodal forces' sizes, which
    # is more than the 111.8 N they add up to since the pressed faces lean different ways.
    (gross,) = [total.gross for total in load_resultants(spec, mesh)]
    assert balance.force_scale == gross > math.hypot(100.0, 50.0)
    assert result.nodes == 14
    assert result.software.calculix == "2.21"


def short_frd(rows: list[str], components: tuple[str, ...] = ("D1", "D2", "D3")) -> str:
    """A result file in the short format (5-digit node numbers) holding one DISP block."""
    header = "  100CL  101 1.000000000           3                     0    1           0"
    lines = ["    1C", "    1PSTEP                         1           1           1", header]
    lines.append(f" -4  DISP        {len(components) + 1}    1")
    lines.extend(f" -5  {c:<10}1    2    {k + 1}    0" for k, c in enumerate(components))
    lines.append(" -5  ALL         1    2    0    0    1ALL")
    return "\n".join([*lines, *rows, " -3", "9999"]) + "\n"


def tensor_block(name: str, components: tuple[str, ...], step: int) -> list[str]:
    header = "  100CL  101 1.000000000           3                     0    1           0"
    rows = [f" -1{n:5d}" + "".join(f"{v:12.5E}" for v in [1.0] * 6) for n in (1, 2, 3)]
    return [
        f"    1PSTEP                         {step}           1           1",
        header,
        f" -4  {name:<10}6    1",
        *(f" -5  {c:<10}1    4    1    1" for c in components),
        *rows,
        " -3",
    ]


def stress_block() -> list[str]:
    """A STRESS and a TOSTRAIN block, every component 1 at nodes 1 to 3."""
    return [
        *tensor_block("STRESS", ("SXX", "SYY", "SZZ", "SXY", "SYZ", "SZX"), 2),
        *tensor_block("TOSTRAIN", ("EXX", "EYY", "EZZ", "EXY", "EYZ", "EZX"), 3),
    ]


def test_reads_the_short_format_and_components_in_any_order(tmp_path: Path) -> None:
    rows = [
        " -1    1 1.00000E-03 2.00000E-03 3.00000E-03",
        " -1    2-4.00000E-03 5.00000E-03-6.00000E-03",
        " -1    3 7.00000E-03 8.00000E-03 9.00000E-03",
    ]
    text = short_frd(rows, components=("D3", "D1", "D2")).replace(
        "9999\n", "\n".join(stress_block()) + "\n9999\n"
    )
    path = tmp_path / "short.frd"
    path.write_text(text)
    fields = read_fields(path, 3)
    # The file's columns are D3, D1, D2; the fields are always x, y, z.
    assert list(fields.displacement[0:3]) == [2.0e-03, 3.0e-03, 1.0e-03]
    assert list(fields.displacement[3:6]) == [5.0e-03, -6.0e-03, -4.0e-03]


def test_reads_continuation_lines(tmp_path: Path) -> None:
    rows = [
        " -1    1 1.00000E+00 2.00000E+00",
        " -2" + " " * 5 + f"{3.0:12.5E}",
        " -1    2 4.00000E+00 5.00000E+00 6.00000E+00",
        " -1    3 7.00000E+00 8.00000E+00 9.00000E+00",
    ]
    path = tmp_path / "cont.frd"
    path.write_text(short_frd(rows).replace("9999\n", "\n".join(stress_block()) + "\n9999\n"))
    assert list(read_fields(path, 3).displacement[0:3]) == [1.0, 2.0, 3.0]


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        ([" -1    1 1.00000E+00 2.00000E+00 3.00000E+00"], "no value for 2 nodes"),
        ([" -1    4 1.00000E+00 2.00000E+00 3.00000E+00"], "outside the mesh"),
        ([" -1    1 1.00000E+00 2.00000E+00"], "has 2 values, expected 3"),
        ([" -1    1 1.00000E+00 2.0000xE+00 3.00000E+00"], "is not a number"),
    ],
)
def test_refuses_a_malformed_block(tmp_path: Path, rows: list[str], message: str) -> None:
    path = tmp_path / "bad.frd"
    path.write_text(short_frd(rows).replace("9999\n", "\n".join(stress_block()) + "\n9999\n"))
    with pytest.raises(FrdError, match=message):
        read_fields(path, 3)


def test_refuses_a_file_without_stresses(tmp_path: Path) -> None:
    path = tmp_path / "disp-only.frd"
    rows = [f" -1{n:5d} 0.00000E+00 0.00000E+00 0.00000E+00" for n in (1, 2, 3)]
    path.write_text(short_frd(rows))
    with pytest.raises(FrdError, match="no STRESS, TOSTRAIN block"):
        read_fields(path, 3)


def test_refuses_a_file_without_strains(tmp_path: Path) -> None:
    # The output of a deck from before M3.1, which asked for stresses only.
    path = tmp_path / "no-strain.frd"
    rows = [f" -1{n:5d} 0.00000E+00 0.00000E+00 0.00000E+00" for n in (1, 2, 3)]
    stress = tensor_block("STRESS", ("SXX", "SYY", "SZZ", "SXY", "SYZ", "SZX"), 2)
    path.write_text(short_frd(rows).replace("9999\n", "\n".join(stress) + "\n9999\n"))
    with pytest.raises(FrdError, match="no TOSTRAIN block"):
        read_fields(path, 3)


def test_refuses_a_binary_result_file(tmp_path: Path) -> None:
    path = tmp_path / "binary.frd"
    path.write_text(short_frd([]).replace("    1           0\n", "    1           2\n", 1))
    with pytest.raises(FrdError, match="not ASCII"):
        read_fields(path, 3)


# --- Supports other than fixed ones (M2.2, ADR-039) ---

#: What CalculiX 2.21 wrote for the supports-c3d10 deck snapshot: two symmetry planes (faces 1
#: at x = 0 and 2 at z = 0), a prescribed y displacement on face 4, a pressure on face 3.
SUPPORTS = Path(__file__).resolve().parent / "fixtures" / "supports"


def test_reads_the_reaction_force_of_every_node_of_a_set() -> None:
    forces = read_node_forces(SUPPORTS / "job.dat", "RALL")
    assert len(forces) == 13
    assert forces[0] == (1.014394e-01, 6.425768e-02, -1.627285e-01)
    assert forces[13] == (-1.666667e01, -2.098787e01, 1.666667e01)


def test_refuses_a_dat_file_without_the_node_set() -> None:
    with pytest.raises(DatError, match="no reaction forces for set RX"):
        read_node_forces(SUPPORTS / "job.dat", "RX")


def test_each_support_gets_the_force_along_the_directions_it_holds() -> None:
    spec = SimulationSpec.model_validate(supports_spec())
    mesh = two_tets(order=2)
    _, result = read_results(spec, mesh, SUPPORTS / "job.frd", SUPPORTS / "job.dat", "2.21")
    rf = read_node_forces(SUPPORTS / "job.dat", "RALL")
    # The pressure on face 3 lands partly on held nodes, where RF includes it (M3.2).
    applied = applied_nodal_loads(spec, mesh, rf)
    assert applied
    forces = {
        n: tuple(f[i] - applied.get(n, (0.0, 0.0, 0.0))[i] for i in range(3)) for n, f in rf.items()
    }

    def nodes(face: int) -> set[int]:
        return {
            mesh.elements[e * 10 + k] for e, local in mesh.faces[face] for k in FACE_NODES[2][local]
        }

    # Every plane and component here lies along a global axis, so each support takes exactly
    # the component it holds at each of its nodes, and nothing a node is free in.
    sym = (sum(forces[n][0] for n in nodes(1)), 0.0, sum(forces[n][2] for n in nodes(2)))
    move = (0.0, sum(forces[n][1] for n in nodes(4)), 0.0)
    got = {r.support_id: r.force for r in result.reactions}
    assert got["sym"] == pytest.approx(sym, abs=1e-9)
    assert got["move"] == pytest.approx(move, abs=1e-9)


# --- Elastic support (M2.6, ADR-043) ---

#: What CalculiX 2.21 wrote for the elastic-sym-c3d10 deck snapshot (elastic supports on faces
#: 2 and 3, a symmetry plane on face 1, a force of (10, 100, -50) N on face 4) and for the
#: elastic-c3d10 one (the fixture's fixed face 1 and pressure, an elastic support on face 4).
ELASTIC = Path(__file__).resolve().parent / "fixtures" / "elastic"
ELASTIC_FIXED = Path(__file__).resolve().parent / "fixtures" / "elastic-fixed"


def test_reads_the_displacement_of_every_node_of_a_set() -> None:
    u = read_node_displacements(ELASTIC / "job.dat", "S2")
    assert sorted(u) == [0, 1, 2, 5, 6, 7]
    assert u[0][2] == pytest.approx(4.95e-4, rel=1e-3)
    with pytest.raises(DatError, match="no displacements for set S9"):
        read_node_displacements(ELASTIC / "job.dat", "S9")


def test_an_elastic_support_reacts_with_the_force_of_its_springs() -> None:
    spec = SimulationSpec.model_validate(elastic_sym_spec())
    mesh = two_tets(order=2)
    _, result = read_results(spec, mesh, ELASTIC / "job.frd", ELASTIC / "job.dat", "")
    got = {r.support_id: r.force for r in result.reactions}
    # The base holds z only: 2000 MN/m³ under its 50 mm², a third on each mid-edge node,
    # pulling back against the slope's lift.
    u = read_node_displacements(ELASTIC / "job.dat", "S2")
    base = sum(2e9 * 5e-5 / 3 * u[n][2] for n in (5, 6, 7))
    assert got["base"] == pytest.approx([0.0, 0.0, -base], abs=1e-9)
    # The slope's two faces lean, so they take the y load and lift z back. Every support
    # together balances the applied force, the symmetry plane taking x.
    total = [sum(r.force[i] for r in result.reactions) for i in range(3)]
    assert total == pytest.approx([-10.0, -100.0, 50.0], abs=1e-4)
    assert got["base"][2] == pytest.approx(-50.0, rel=1e-5)
    assert got["sym"][1:] == [0.0, 0.0]


def test_an_elastic_support_beside_a_fixed_one_shares_the_load() -> None:
    spec = SimulationSpec.model_validate(elastic_spec())
    mesh = two_tets(order=2)
    dat = ELASTIC_FIXED / "job.dat"
    _, result = read_results(spec, mesh, ELASTIC_FIXED / "job.frd", dat, "")
    got = {r.support_id: r.force for r in result.reactions}
    # Face 4 meets the fixed face, so its springs hardly move.
    assert max(abs(f) for f in got["elastic-1"]) < 1e-2
    # Together they balance the pressures, (-100, 0, 50) N.
    total = [got["fixed-1"][i] + got["elastic-1"][i] for i in range(3)]
    assert total == pytest.approx([100.0, 0.0, -50.0], abs=1e-4)
    # Reactions to seven printed digits, much larger than the loads (the heat pushes on the
    # support).
    assert result.balance is not None and result.balance.force_ratio < 1e-4


def test_balance_without_applied_load_measures_reactions_against_each_other() -> None:
    # A temperature change or a prescribed displacement: two ends pushing back equally.
    mesh = two_tets(order=1)
    ends = [
        Reaction((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        Reaction((5.0, 0.0, 0.001), (0.0, 0.0, 0.0), (0.01, 0.0, 0.0), (0.0, -1e-5, 0.0)),
    ]
    got = balance(mesh, [NO_LOAD], ends)
    assert got["forceScale"] == pytest.approx(10.0, rel=1e-6)
    assert got["forceRatio"] == pytest.approx(0.001 / got["forceScale"], rel=1e-9)
    # The moment is measured against the force times the mesh's diagonal (10 mm cube).
    assert got["momentScale"] == pytest.approx(got["forceScale"] * math.sqrt(3) * 0.01, rel=1e-9)
    assert got["momentRatio"] == pytest.approx(1e-5 / got["momentScale"], rel=1e-9)
    assert balance(mesh, [], [])["forceRatio"] == 0.0


def test_balance_of_a_load_that_cancels_itself_is_measured_against_its_gross_size() -> None:
    # A pressure all round a bore adds up to nothing, and so do the reactions; their tiny
    # rounding must be measured against the pressure's size, not against itself (V-01).
    mesh = two_tets(order=1)
    bore = Resultant((1e-10, 0.0, 0.0), (0.0, 0.0, 0.0), 7.5e5)
    end = [Reaction((-4e-4, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))]
    got = balance(mesh, [bore], end)
    assert got["forceScale"] == 7.5e5
    assert got["forceRatio"] == pytest.approx(4e-4 / 7.5e5, rel=1e-6)


# --- Steady-state thermal runs (M5.1, ADR-064) ---

#: What CalculiX 2.21 wrote for the heat-two-bodies-c3d4 deck snapshot: two one-element
#: bodies with no shared nodes, body 1 held at 373.15 K on one face, body 2 at 293.15 K; and
#: for the heat-loads-c3d10 one (every thermal load, M5.2), solved with SPOOLES since the
#: host's ccx has no PaStiX (the same equations).
HEAT = Path(__file__).resolve().parent / "fixtures" / "heat"


def test_reads_the_temperature_of_every_node() -> None:
    fields = read_thermal_fields(HEAT / "heat-two-bodies-c3d4.frd", 8)
    assert list(fields.temperature) == [373.15] * 4 + [293.15] * 4
    # Each body is at one temperature, so no heat flows (M5.3): what CalculiX writes is
    # rounding, at most a few nW/m².
    assert list(fields.heat_flux) == pytest.approx([0.0] * 24, abs=1e-7)


def test_thermal_run_summary_has_temperatures_and_no_structural_results(tmp_path: Path) -> None:
    spec = SimulationSpec.model_validate(heat_two_bodies_spec())
    mesh = bonded_tets(1)
    fields, result = read_results(
        spec, mesh, HEAT / "heat-two-bodies-c3d4.frd", HEAT / "heat-two-bodies-c3d4.dat", "2.21"
    )
    assert result.temperature is not None
    assert result.temperature.max.value == 373.15
    assert result.temperature.max.node == 0
    assert result.temperature.min.value == 293.15
    assert result.temperature.min.node == 4
    assert result.temperature.min.position == list(mesh.positions[12:15])
    dumped = result.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert set(dumped) == {
        "nodes",
        "temperature",
        "heatFlux",
        "heatFlows",
        "heatBalance",
        "software",
    }
    assert [f["loadId"] for f in dumped["heatFlows"]] == [x.id for x in spec.loads]
    # No heat flows, only CalculiX's rounding (1e-13 W): the balance is measured against at
    # least a millionth of a millionth of k T L, not against the rounding itself.
    got = dumped["heatBalance"]
    assert got["heatIn"] < 1e-12 and got["heatOut"] < 1e-12
    assert got["ratio"] < 1e-3
    files = write_viewer_files(mesh, fields, tmp_path)
    for path in (files.fields_path, files.nodes_path):
        _, written = read_fields_file(path)
        assert [(f.name, f.kind, f.components) for f in written] == [
            ("temperature", "temperature", 1),
            ("heatFlux", "heatFlux", 3),
        ]
    _, nodes = read_fields_file(files.nodes_path)
    assert list(nodes[0].values) == pytest.approx(list(fields.temperature), rel=1e-7)


def _face_area(mesh, face: int) -> float:  # type: ignore[no-untyped-def]
    """The area of a flat face of the mesh from its element faces' corners."""
    npe = 10 if mesh.order == 2 else 4
    p = mesh.positions
    total = 0.0
    for element, local in mesh.faces[face]:
        a, b, c = (mesh.elements[element * npe + k] for k in FACE_NODES[mesh.order][local][:3])
        u = [p[3 * b + i] - p[3 * a + i] for i in range(3)]
        v = [p[3 * c + i] - p[3 * a + i] for i in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        total += math.sqrt(sum(x * x for x in n)) / 2
    return total


def _volume(mesh, first: int, count: int) -> float:  # type: ignore[no-untyped-def]
    """The volume of straight-edged four- or ten-node tetrahedra from their corners."""
    npe = 10 if mesh.order == 2 else 4
    p = mesh.positions
    total = 0.0
    for e in range(first, first + count):
        a, b, c, d = (mesh.elements[e * npe + k] for k in range(4))
        u, v, w = ([p[3 * x + i] - p[3 * a + i] for i in range(3)] for x in (b, c, d))
        det = (
            u[0] * (v[1] * w[2] - v[2] * w[1])
            - u[1] * (v[0] * w[2] - v[2] * w[0])
            + u[2] * (v[0] * w[1] - v[1] * w[0])
        )
        total += abs(det) / 6
    return total


def test_heat_flows_of_every_thermal_load_balance(tmp_path: Path) -> None:
    # M5.3: each load's heat flow from the loads and the solved temperatures, the fixed
    # temperature's from CalculiX's RFL with the other loads' heat at its nodes taken out.
    spec = SimulationSpec.model_validate(heat_loads_spec())
    mesh = two_tets(order=2)
    fields, result = read_results(
        spec, mesh, HEAT / "heat-loads-c3d10.frd", HEAT / "heat-loads-c3d10.dat", "2.21"
    )
    flows = {f.load_id: f.heat for f in result.heat_flows or []}
    assert list(flows) == ["hot-1", "q-1", "q-2", "h-1", "r-1", "g-1"]
    # A uniform flux brings in its value times the face's area; heat generation its power
    # times the body's volume (both elements are straight-edged).
    area = _face_area(mesh, 2)
    assert flows["q-1"] == pytest.approx(20000 * area, rel=1e-12)
    assert flows["q-2"] == pytest.approx(5000 * area, rel=1e-12)
    first, count = mesh.bodies[1]
    assert flows["g-1"] == pytest.approx(1e6 * _volume(mesh, first, count), rel=1e-12)
    # The faces are above the ambient, so convection and radiation take heat out.
    assert flows["h-1"] < 0 and flows["r-1"] < 0
    balance = result.heat_balance
    assert balance is not None
    heat_in = flows["q-1"] + flows["q-2"] + flows["g-1"]
    assert balance.heat_in == pytest.approx(heat_in, rel=1e-12)
    assert balance.heat_out == pytest.approx(-(flows["hot-1"] + flows["h-1"] + flows["r-1"]))
    # The solver's equations hold to its printed digits.
    assert balance.ratio < 1e-5
    # Half the gross heat flow is a little above the heat in: the fixed temperature's nodal
    # heat flows on a ten-node face are not all of one sign.
    assert heat_in <= balance.scale <= 1.05 * heat_in
    assert result.heat_flux is not None
    q = fields.heat_flux
    node = result.heat_flux.max.node
    size = math.sqrt(sum(q[3 * node + i] ** 2 for i in range(3)))
    assert result.heat_flux.max.value == size > 0


def test_a_heat_balance_measures_a_self_cancelling_load_by_its_size() -> None:
    # A convection that heats half its face and cools the other half nets zero; the balance
    # is measured against half the gross of every load, not against the net heat in.
    flows = [HeatFlow(0.0, {}, 10.0), HeatFlow(1.0, {}, 1.0), HeatFlow(-0.999, {}, 0.999)]
    got = heat_balance(flows, 1e-9)
    assert got["heatIn"] == 1.0 and got["heatOut"] == 0.999
    assert got["scale"] == pytest.approx(5.9995)
    assert got["ratio"] == pytest.approx(0.001 / 5.9995)
    # The floor stands in for a scale smaller than it, such as no heat flow at all.
    assert heat_balance([], 0.0)["ratio"] == 0.0
    assert heat_balance([HeatFlow(1e-12, {}, 2e-12)], 1e-6) == {
        "heatIn": 1e-12,
        "heatOut": 0.0,
        "scale": 1e-6,
        "ratio": 1e-6,
    }


def test_reads_nodal_heat_flows_and_temperatures_from_the_dat_file() -> None:
    flows = read_node_heat_flows(HEAT / "heat-loads-c3d10.dat", "TALL")
    assert sorted(flows) == [0, 2, 3, 7, 8, 9]
    assert flows[0] == -1.103052e-01
    temperatures = read_node_temperatures(HEAT / "heat-loads-c3d10.dat", "xall")
    assert temperatures[1] == 3.760814e02
    with pytest.raises(DatError, match="no heat flows for set XALL"):
        read_node_heat_flows(HEAT / "heat-loads-c3d10.dat", "XALL")


def test_a_thermal_run_without_its_heat_flows_is_refused(tmp_path: Path) -> None:
    spec = SimulationSpec.model_validate(heat_two_bodies_spec())
    (tmp_path / "job.dat").write_text("")
    with pytest.raises(DatError, match="no heat flows for set TALL"):
        read_results(
            spec, bonded_tets(1), HEAT / "heat-two-bodies-c3d4.frd", tmp_path / "job.dat", "2.21"
        )


def test_refuses_a_thermal_result_file_without_temperatures() -> None:
    with pytest.raises(FrdError, match="no FLUX, NDTEMP block"):
        read_thermal_fields(SOLVE / "job.frd", 14)


def test_a_thermal_stress_run_has_both_steps_results() -> None:
    # M5.4: the heat transfer step's temperatures, heat fluxes and heat flows, and the static
    # step's displacements, stresses and reactions, read from the same two files.
    spec = SimulationSpec.model_validate(thermal_stress_spec())
    mesh = two_tets(order=2)
    fields, result = read_results(
        spec,
        mesh,
        HEAT / "thermal-stress-c3d10.frd",
        HEAT / "thermal-stress-c3d10.dat",
        "2.21",
    )
    assert fields.thermal is not None
    assert result.temperature is not None and result.von_mises is not None
    assert result.temperature.max.value == pytest.approx(373.15, abs=1e-3)
    # The heat flows are the thermal loads', the load totals the structural loads' only.
    assert [f.load_id for f in result.heat_flows or []] == ["hot-1", "h-1", "r-1"]
    assert [x.load_id for x in result.loads or []] == ["p-1", "g-1"]
    assert result.heat_balance is not None and result.heat_balance.ratio < 1e-5
    # Reactions to seven printed digits, much larger than the loads (the heat pushes on the
    # support).
    assert result.balance is not None and result.balance.force_ratio < 1e-4
    names = [f.name for f in node_fields(fields)]
    assert names == [
        "displacement",
        "vonMises",
        "stress",
        "principalStress",
        "strain",
        "temperature",
        "heatFlux",
    ]
    # The structural fields are the static step's: the heated part grows.
    assert result.displacement is not None and result.displacement.max.value > 0
