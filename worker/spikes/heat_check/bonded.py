# SPDX-License-Identifier: AGPL-3.0-or-later
"""M5.6 part of the heat check: bonds carry heat (ADR-069). The bar of check.py cut across at
x = L1 into two bodies of different materials, touching but meshed apart (ADR-058), so the
bond's faces have nodes of their own and the temperature ties (deck/loads/tie.py) carry the
heat across. Every case is one-dimensional along the bar, so each node has a closed form:

- fixed temperatures on both ends: the series wall, a linear profile in each body with the
  flux (T_hot − T_cold)/(L1/k1 + L2/k2);
- a fixed temperature at x = 0 and convection at x = L: the same with 1/h added;
- the series wall as a thermal stress analysis, held on the x = 0 end and the four sides:
  σyy = σzz = −E_i α (T − T₀)/(1 − ν) in each body, ux = α (1 + ν)/(1 − ν) ∫(T − T₀);
- a fixed temperature on the first body's side faces, which meet the bond: no closed form, but
  the heat balance only closes when the reader adds the heat CalculiX leaves out of the
  nodal heat flow of fixed-temperature nodes that tied nodes follow (results/heat.py).
"""

from pathlib import Path

from clearfea_worker.geometry.importer import import_geometry
from clearfea_worker.meshing.mesher import mesh_geometry
from clearfea_worker.meshing.volume import read_volume_mesh
from clearfea_worker.spec.geometry_schema import Topology
from clearfea_worker.spec.simulation_schema import SimulationSpec

#: Where the bar is cut, mm and m.
L1 = 120.0
L1M = L1 / 1000


def write_two_part_bar(path: Path, length: float, height: float) -> Path:
    """Two touching boxes, not fused: x from 0 to L1 and from L1 to ``length``."""
    import gmsh

    gmsh.initialize(readConfigFiles=False, interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.occ.addBox(0, 0, 0, L1, height, height)
        gmsh.model.occ.addBox(L1, 0, 0, length - L1, height, height)
        gmsh.model.occ.synchronize()
        gmsh.write(str(path))
    finally:
        gmsh.finalize()
    return path


def faces_at(topology: Topology, axis: int, value: float) -> list[int]:
    return [f.tag for f in topology.faces if abs(f.centroid[axis] - value) < 1e-9]


def bonded_setup(
    root: Path, length: float, height: float, order: int
) -> tuple[Topology, object, list[list[int]]]:
    """The two-part bar's topology, mesh and its one bond's faces."""
    step = root / "two-part-bar.step"
    if not step.exists():
        write_two_part_bar(step, length, height)
        import_geometry(step, root / "import-bonded", None)
    topology = Topology.model_validate_json((root / "import-bonded" / "topology.json").read_bytes())
    if len(topology.bonds or []) != 1:
        raise RuntimeError(f"expected one bond, found {topology.bonds}")
    out = mesh_geometry(
        step,
        topology,
        root / f"mesh-bonded-p{order}",
        scaling=1.0,
        size=0.01,
        unit="mm",
        order=order,
    )
    bonds = [list(b.faces) for b in topology.bonds or []]
    return topology, read_volume_mesh(out.mesh_path), bonds


def bonded_spec(
    base: dict, bonds: list[list[int]], second: dict, loads: list[dict]
) -> SimulationSpec:
    """``base`` (a one-body spec dumped by alias) with body 2 of material ``second`` and the
    bond accepted."""
    setup = dict(base)
    setup["bodies"] = [{"tag": 1, "material": "steel"}, {"tag": 2, "material": second["id"]}]
    setup["materials"] = [*base["materials"], second]
    setup["bonds"] = [{"faces": faces, "status": "accepted"} for faces in bonds]
    setup["loads"] = loads
    return SimulationSpec.model_validate(setup)
