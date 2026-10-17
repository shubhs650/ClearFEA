# SPDX-License-Identifier: AGPL-3.0-or-later
"""Acceptance case A geometry: a cylindrical shell section with a set-in nozzle and a
reinforcing pad, three bodies of one assembly, written as a STEP file in millimetres.

    cd worker
    uv run python ../verification/acceptance/A-nozzle-on-shell/geometry.py OUT.step

An original design for this project (M9.4), not taken from a standard, book or drawing:

- Shell: inside radius 300 mm, wall 10 mm, along x from x = -600 mm (the held end) to
  x = +600 mm (the end that carries the head's pressure thrust).
- Nozzle: inside radius 75 mm, wall 8 mm, on top of the shell at x = 0 with its axis along z,
  set in through the shell and the pad, its foot flush with the shell's inside surface, its
  end at z = 560 mm (250 mm out from the shell's outside).
- Pad: 10 mm thick on the shell's outside, the part of a 165 mm radius cylinder about the
  nozzle's axis, with the nozzle's 83 mm radius hole through it.

The bodies touch and are not fused, so the importer finds three bonds: shell to nozzle,
pad to nozzle and pad to shell. OpenCASCADE names its products "Open CASCADE STEP translator
..."; they are replaced with an assembly name and the part names "Shell", "Nozzle" and
"Reinforcing pad", as a CAD system writes them, so the Bodies group lists them by name.
"""

import re
import sys
from pathlib import Path

import gmsh

#: Shell inside and outside radius, its ends, and the pad's thickness, in mm.
SHELL_RI, SHELL_RO, X_HELD, X_FREE, PAD_T = 300.0, 310.0, -600.0, 600.0, 10.0
#: Nozzle inside and outside radius, the height of its end, and the pad's radius, in mm.
NOZZLE_RI, NOZZLE_RO, NOZZLE_TOP, PAD_R = 75.0, 83.0, 560.0, 165.0


def tube_x(r_out: float, r_in: float) -> list[tuple[int, int]]:
    """A tube along x over the shell's length."""
    occ = gmsh.model.occ
    length = X_FREE - X_HELD
    outer = occ.addCylinder(X_HELD, 0, 0, length, 0, 0, r_out)
    inner = occ.addCylinder(X_HELD, 0, 0, length, 0, 0, r_in)
    tube, _ = occ.cut([(3, outer)], [(3, inner)])
    return tube


def rod_z(radius: float) -> list[tuple[int, int]]:
    """A solid cylinder along z from the shell's axis to the nozzle's end."""
    return [(3, gmsh.model.occ.addCylinder(0, 0, 0, 0, 0, NOZZLE_TOP, radius))]


def main(path: str) -> None:
    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        # OpenCASCADE keeps an earlier import's unit for later writes; say it every time.
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        occ = gmsh.model.occ
        shell, _ = occ.cut(tube_x(SHELL_RO, SHELL_RI), rod_z(NOZZLE_RO))
        pad, _ = occ.intersect(tube_x(SHELL_RO + PAD_T, SHELL_RO), rod_z(PAD_R))
        pad, _ = occ.cut(pad, rod_z(NOZZLE_RO))
        nozzle, _ = occ.cut(rod_z(NOZZLE_RO), rod_z(NOZZLE_RI))
        bore = occ.addCylinder(X_HELD, 0, 0, X_FREE - X_HELD, 0, 0, SHELL_RI)
        nozzle, _ = occ.cut(nozzle, [(3, bore)])
        occ.synchronize()
        parts = {}
        for name, dimtags in (("Shell", shell), ("Nozzle", nozzle), ("Reinforcing pad", pad)):
            if len(dimtags) != 1:
                raise RuntimeError(f"expected one solid for the {name}, got {dimtags}")
            parts[dimtags[0][1]] = name
        if sorted(parts) != [t for _, t in gmsh.model.getEntities(3)]:
            raise RuntimeError(f"expected exactly the three parts as solids, got {parts}")
        gmsh.write(path)
    finally:
        gmsh.finalize()
    # The assembly's product first, then one per solid in the order of their tags.
    name_products(Path(path), [ASSEMBLY] + [parts[t] for t in sorted(parts)])


#: The assembly's product name.
ASSEMBLY = "Nozzle on shell"


def name_products(step: Path, names: list[str]) -> None:
    """Replaces OpenCASCADE's placeholder product names with ``names``, in file order."""
    text = step.read_text()
    found = list(dict.fromkeys(re.findall(r"'Open CASCADE STEP translator [0-9.]+ [0-9.]+'", text)))
    if len(found) != len(names):
        raise ValueError(f"expected {len(names)} product names, found {found}")
    for placeholder, name in zip(found, names, strict=True):
        text = text.replace(placeholder, repr(name))
    step.write_text(text)


if __name__ == "__main__":
    main(sys.argv[1])
