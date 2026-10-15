# SPDX-License-Identifier: AGPL-3.0-or-later
import struct
from pathlib import Path

import pytest

from clearfea_worker.geometry.display import FacePatch, read_display, write_display


def test_round_trips_faces_with_their_own_vertices(tmp_path: Path) -> None:
    square = FacePatch(7, [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 0, 2, 3])
    tri = FacePatch(3, [0, 0, 0.5, 1, 0, 0.5, 0, 1, 0.5], [0, 1, 2])
    path = tmp_path / "display.bin"
    assert write_display(path, [square, tri]) == 3
    data = path.read_bytes()
    assert data[:4] == b"CFDM"
    assert struct.unpack_from("<IIII", data, 4) == (1, 7, 3, 2)
    # Faces are stored in tag order, each with its own vertex and triangle range.
    assert read_display(path) == [
        FacePatch(3, [0, 0, 0.5, 1, 0, 0.5, 0, 1, 0.5], [0, 1, 2]),
        square,
    ]
    assert struct.unpack_from("<iIIIIiIIII", data, len(data) - 40) == (3, 0, 3, 0, 1, 7, 3, 4, 1, 2)


def test_refuses_a_file_with_the_wrong_magic(tmp_path: Path) -> None:
    path = tmp_path / "display.bin"
    path.write_bytes(b"XXXX" + bytes(16))
    with pytest.raises(ValueError, match="not a version 1"):
        read_display(path)


FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "spec" / "fixtures"

# The faces in packages/spec/fixtures/display-two-faces.bin. The web viewer's reader is
# tested against the same file (apps/web/test/displayMesh.test.ts).
FIXTURE_FACES = [
    FacePatch(7, [0, 0, 0, 0.1, 0, 0, 0.1, 0.05, 0, 0, 0.05, 0], [0, 1, 2, 0, 2, 3]),
    FacePatch(3, [0, 0, 0.02, 0.1, 0, 0.02, 0, 0.05, 0.02], [0, 1, 2]),
]


def test_writes_the_shared_fixture_byte_for_byte(tmp_path: Path) -> None:
    path = tmp_path / "display.bin"
    write_display(path, FIXTURE_FACES)
    assert path.read_bytes() == (FIXTURE / "display-two-faces.bin").read_bytes()
