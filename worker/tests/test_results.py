# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction from CalculiX output (no solver runs).

tests/fixtures/solve/ holds what CalculiX 2.21 wrote for the fixture-c3d10 deck snapshot
(tests/snapshots/deck/): two C3D10 elements, one fixed face, two pressed faces.
"""

import math
from pathlib import Path

import pytest

from clearfea_worker.deck.applied import applied_nodal_loads
from clearfea_worker.deck.elements import FACE_NODES
from clearfea_worker.results import (
    DatError,
    FrdError,
    principal_stresses,
    read_fields,
    read_node_displacements,
    read_node_forces,
    read_results,
    von_mises,
)
from clearfea_worker.results.summary import Reaction, balance
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import two_tets
from .test_deck import elastic_spec, elastic_sym_spec, fixture_spec, supports_spec

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
    assert balance.force_scale == pytest.approx(math.hypot(100.0, 50.0), rel=1e-6)
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
    assert result.balance is not None and result.balance.force_ratio < 1e-6


def test_balance_without_applied_load_measures_reactions_against_each_other() -> None:
    # A temperature change or a prescribed displacement: two ends pushing back equally.
    mesh = two_tets(order=1)
    ends = [
        Reaction((-5.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)),
        Reaction((5.0, 0.0, 0.001), (0.0, 0.0, 0.0), (0.01, 0.0, 0.0), (0.0, -1e-5, 0.0)),
    ]
    got = balance(mesh, [((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))], ends)
    assert got["forceScale"] == pytest.approx(10.0, rel=1e-6)
    assert got["forceRatio"] == pytest.approx(0.001 / got["forceScale"], rel=1e-9)
    # The moment is measured against the force times the mesh's diagonal (10 mm cube).
    assert got["momentScale"] == pytest.approx(got["forceScale"] * math.sqrt(3) * 0.01, rel=1e-9)
    assert got["momentRatio"] == pytest.approx(1e-5 / got["momentScale"], rel=1e-9)
    assert balance(mesh, [], [])["forceRatio"] == 0.0
