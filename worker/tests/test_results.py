# SPDX-License-Identifier: AGPL-3.0-or-later
"""Result extraction from CalculiX output (no solver runs).

tests/fixtures/solve/ holds what CalculiX 2.21 wrote for the fixture-c3d10 deck snapshot
(tests/snapshots/deck/): two C3D10 elements, one fixed face, two pressed faces.
"""

import math
from pathlib import Path

import pytest

from clearfea_worker.deck.elements import FACE_NODES
from clearfea_worker.results import (
    DatError,
    FrdError,
    read_fields,
    read_node_forces,
    read_reaction_totals,
    read_results,
    von_mises,
)
from clearfea_worker.spec.simulation_schema import SimulationSpec

from .deck_meshes import two_tets
from .test_deck import fixture_spec, supports_spec

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


def test_von_mises_of_known_stress_states() -> None:
    assert von_mises(-1.0e6, 0, 0, 0, 0, 0) == pytest.approx(1.0e6)
    assert von_mises(0, 0, 0, 2.0e6, 0, 0) == pytest.approx(math.sqrt(3) * 2.0e6)
    assert von_mises(0, 0, 0, 0, 0, 2.0e6) == pytest.approx(math.sqrt(3) * 2.0e6)
    assert von_mises(5.0e6, 5.0e6, 5.0e6, 0, 0, 0) == pytest.approx(0.0, abs=1e-9)
    # Plane stress s1 = 100, s2 = 50: sqrt(s1^2 - s1 s2 + s2^2).
    assert von_mises(100.0, 50.0, 0, 0, 0, 0) == pytest.approx(math.sqrt(7500.0))


def test_reads_the_total_reaction_of_each_support_set() -> None:
    totals = read_reaction_totals(SOLVE / "job.dat", ["S1"])
    assert totals == {"S1": (100.0, 1.354472e-14, -33.33333)}


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
    assert result.reactions[0].force == [100.0, 1.354472e-14, -33.33333]
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


def stress_block() -> list[str]:
    header = "  100CL  101 1.000000000           3                     0    1           0"
    rows = [f" -1{n:5d}" + "".join(f"{v:12.5E}" for v in [1.0] * 6) for n in (1, 2, 3)]
    return [
        "    1PSTEP                         2           1           1",
        header,
        " -4  STRESS      6    1",
        *(f" -5  {c:<10}1    4    1    1" for c in ("SXX", "SYY", "SZZ", "SXY", "SYZ", "SZX")),
        *rows,
        " -3",
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
    with pytest.raises(FrdError, match="no STRESS block"):
        read_fields(path, 3)


def test_refuses_a_binary_result_file(tmp_path: Path) -> None:
    path = tmp_path / "binary.frd"
    path.write_text(short_frd([]).replace("    1           0\n", "    1           2\n", 1))
    with pytest.raises(FrdError, match="not ASCII"):
        read_fields(path, 3)


def test_refuses_a_dat_file_without_the_support_set() -> None:
    with pytest.raises(DatError, match="no total reaction for S2"):
        read_reaction_totals(SOLVE / "job.dat", ["S1", "S2"])


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
    forces = read_node_forces(SUPPORTS / "job.dat", "RALL")

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
