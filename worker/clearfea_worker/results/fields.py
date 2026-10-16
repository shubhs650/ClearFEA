# SPDX-License-Identifier: AGPL-3.0-or-later
"""Nodal displacement, stress and strain from the solver output, and the derived von Mises
and principal stresses; nodal temperatures and heat flux of a steady-state thermal run (M5.1,
M5.3), and both of a thermal stress run (M5.4).

Physics-critical (ADR-030, ADR-050). CalculiX writes stresses and strains extrapolated from the
integration points to the nodes and averaged over the elements that share a node; von Mises
and the principal stresses are derived from those nodal stresses. The strain is CalculiX's
total strain (``E``: elastic plus thermal), with tensor shear components (half the engineering
shear strain). The heat flux is CalculiX's too (``HFL``: the vector q = -k grad T, W/m², from
the integration points to the nodes and averaged in the same way). Everything is SI: metres,
pascals, m/m, kelvin and W/m².
"""

import math
from array import array
from dataclasses import dataclass
from pathlib import Path

from .frd import FrdError, NodalBlock, read_nodal_blocks

DISPLACEMENT = ("D1", "D2", "D3")
#: CalculiX's order: normal stresses, then the shear stresses xy, yz, zx.
STRESS = ("SXX", "SYY", "SZZ", "SXY", "SYZ", "SZX")
#: The same order for the total strain.
STRAIN = ("EXX", "EYY", "EZZ", "EXY", "EYZ", "EZX")
#: The heat flux vector's x, y and z components.
HEAT_FLUX = ("F1", "F2", "F3")


@dataclass(frozen=True)
class ThermalFields:
    """``temperature[n]``: the temperature of node n in kelvin (M5.1), and since M5.3
    ``heat_flux[3 n + i]``: component i of its heat flux in W/m², both as CalculiX wrote them."""

    node_count: int
    temperature: array
    heat_flux: array


@dataclass(frozen=True)
class NodalFields:
    """``displacement[3 n + i]`` (m), ``stress[6 n + i]`` (Pa, in STRESS order) and
    ``strain[6 n + i]`` (m/m, in STRAIN order, tensor shear components) of node n, and since
    M3.5 ``safety_factor[n]``, its safety factor against yield (results.safety), when every
    material of the setup has a yield strength. A thermal stress run (M5.4) also has the
    temperatures and heat fluxes its thermal step solved, ``thermal``."""

    node_count: int
    displacement: array
    stress: array
    strain: array
    safety_factor: array | None = None
    thermal: ThermalFields | None = None


def read_thermal_fields(frd: Path, node_count: int) -> ThermalFields:
    """The temperature and heat flux of every node from the ``.frd`` file of a heat transfer
    step."""
    blocks = read_nodal_blocks(frd, node_count, {"NDTEMP", "FLUX"})
    temperature = _ordered(blocks["NDTEMP"], ("T",))
    heat_flux = _ordered(blocks["FLUX"], HEAT_FLUX)
    if not all(math.isfinite(v) for v in (*temperature, *heat_flux)):
        raise FrdError("The result file holds values that are not finite numbers.")
    return ThermalFields(node_count, temperature, heat_flux)


def von_mises(sxx: float, syy: float, szz: float, sxy: float, syz: float, szx: float) -> float:
    """Von Mises equivalent stress of a stress tensor given by its six components."""
    normal = (sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2
    return math.sqrt(0.5 * normal + 3.0 * (sxy**2 + syz**2 + szx**2))


def principal_stresses(
    sxx: float, syy: float, szz: float, sxy: float, syz: float, szx: float
) -> tuple[float, float, float]:
    """The principal stresses σ1 ≥ σ2 ≥ σ3: the eigenvalues of the symmetric stress tensor.

    Closed form for a symmetric 3 × 3 matrix (O. K. Smith, "Eigenvalues of a symmetric 3 × 3
    matrix", Communications of the ACM 4(4), 1961): with q the mean normal stress and p the
    size of the deviator, the eigenvalues are q + 2 p cos(φ + 2πk/3), φ = acos(det(B) / 2) / 3,
    B = (σ − q I) / p. Exact for a diagonal tensor; the middle value comes from the trace so
    the three add up to it.
    """
    q = (sxx + syy + szz) / 3.0
    dx, dy, dz = sxx - q, syy - q, szz - q
    shear = sxy * sxy + syz * syz + szx * szx
    p2 = (dx * dx + dy * dy + dz * dz + 2.0 * shear) / 6.0
    if shear == 0.0 or p2 == 0.0:
        a, b, c = sorted((sxx, syy, szz), reverse=True)
        return a, b, c
    p = math.sqrt(p2)
    bx, by, bz, bxy, byz, bzx = dx / p, dy / p, dz / p, sxy / p, syz / p, szx / p
    det = bx * (by * bz - byz * byz) - bxy * (bxy * bz - byz * bzx) + bzx * (bxy * byz - by * bzx)
    phi = math.acos(min(max(det / 2.0, -1.0), 1.0)) / 3.0
    first = q + 2.0 * p * math.cos(phi)
    third = q + 2.0 * p * math.cos(phi + 2.0 * math.pi / 3.0)
    second = 3.0 * q - first - third
    a, b, c = sorted((first, second, third), reverse=True)
    return a, b, c


def _ordered(block: NodalBlock, names: tuple[str, ...]) -> array:
    """The block's values with components in ``names`` order."""
    if set(block.components) != set(names) or len(block.components) != len(names):
        raise FrdError(
            f"{block.name} has components {', '.join(block.components)}, "
            f"expected {', '.join(names)}."
        )
    if block.missing():
        raise FrdError(f"{block.name} has no value for {block.missing()} nodes of the mesh.")
    if block.components == names:
        return block.values
    index = [block.components.index(name) for name in names]
    width = len(names)
    src = block.values
    return array("d", (src[n * width + i] for n in range(len(src) // width) for i in index))


def read_fields(frd: Path, node_count: int) -> NodalFields:
    """Displacement, stress and total strain of every node from the ``.frd`` file."""
    blocks = read_nodal_blocks(frd, node_count, {"DISP", "STRESS", "TOSTRAIN"})
    fields = NodalFields(
        node_count,
        _ordered(blocks["DISP"], DISPLACEMENT),
        _ordered(blocks["STRESS"], STRESS),
        _ordered(blocks["TOSTRAIN"], STRAIN),
    )
    values = (*fields.displacement, *fields.stress, *fields.strain)
    if not all(math.isfinite(v) for v in values):
        raise FrdError("The result file holds values that are not finite numbers.")
    return fields


def displacement_magnitude(fields: NodalFields) -> array:
    d = fields.displacement
    return array(
        "d",
        (
            math.sqrt(d[3 * n] ** 2 + d[3 * n + 1] ** 2 + d[3 * n + 2] ** 2)
            for n in range(fields.node_count)
        ),
    )


def heat_flux_magnitude(fields: ThermalFields) -> array:
    q = fields.heat_flux
    return array(
        "d",
        (
            math.sqrt(q[3 * n] ** 2 + q[3 * n + 1] ** 2 + q[3 * n + 2] ** 2)
            for n in range(fields.node_count)
        ),
    )


def von_mises_field(fields: NodalFields) -> array:
    s = fields.stress
    return array("d", (von_mises(*s[6 * n : 6 * n + 6]) for n in range(fields.node_count)))


def principal_field(fields: NodalFields) -> array:
    """``out[3 n + i]``: principal stress i + 1 of node n (σ1 ≥ σ2 ≥ σ3), in pascals."""
    s = fields.stress
    return array(
        "d",
        (v for n in range(fields.node_count) for v in principal_stresses(*s[6 * n : 6 * n + 6])),
    )
