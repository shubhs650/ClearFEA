# SPDX-License-Identifier: AGPL-3.0-or-later
"""Local shell stresses at the nozzle of acceptance case A by Bijlaard's method, the analysis
behind the WRC Bulletin 107 curves, computed here from the shell equations instead of read
from the bulletin's charts (which are not reproduced; hand_checks.md says why and what differs).

    python verification/acceptance/A-nozzle-on-shell/wrc_style.py [--json OUT]

Method (Bijlaard, "Stresses from local loadings in cylindrical pressure vessels", Trans. ASME
77, 1955; the same approach WRC 107 tabulates):

- The shell is a cylinder of mean radius R, thickness t and length L, simply supported at both
  ends (w = v = 0, Nx = Mx = 0). The attachment is replaced by a load spread over a rectangle of
  half-sides c1 (around the shell) and c2 (along it) at mid-length; for a round attachment of
  radius r0 WRC 107 takes a square of half-side 0.875 r0.
- A radial load P is a uniform pressure P / (4 c1 c2) on the rectangle. A longitudinal moment
  ML is a pressure varying linearly along the shell, a circumferential moment MC one varying
  linearly around it, each with the entered moment about the rectangle's centre.
- The load is expanded in a double Fourier series, cos nθ (or sin nθ) around and sin(mπx/L)
  along. Each term is solved exactly with the Sanders (Koiter-Sanders) shell equations: the
  displacement u = A cos nθ cos λx, v = B sin nθ sin λx, w = C cos nθ sin λx meets the end
  conditions, and minimising the strain energy gives a 3 × 3 system for A, B, C. Bijlaard
  solved simplified (Donnell-type) equations; Sanders' keep the n = 0, 1 terms right too.
- The membrane forces and bending moments are summed at the stress points, and the stress at
  the outside (u) and inside (l) surfaces is membrane ± bending.

The shear loads and the torsion moment give the shear stresses of WRC 107's simple formulas,
VC / (π r0 t), VL / (π r0 t) and MT / (2π r0² t), as magnitudes.

Pure Python, no dependencies. Units: N, mm, MPa.
"""

import argparse
import json
import math
from collections.abc import Callable
from dataclasses import dataclass

#: Case A's material: carbon steel case values (model.md).
E, NU = 200e3, 0.3

#: Series terms along (m) and around (n) the shell. The stresses at the edge of the loaded
#: square change by less than 0.5 percent from 200 to 300 terms (checked with --terms).
TERMS = 300


@dataclass(frozen=True)
class Shell:
    radius: float  # mean radius R
    thickness: float  # t
    length: float  # L, between the simple supports

    @property
    def membrane(self) -> float:
        return E * self.thickness / (1 - NU**2)

    @property
    def bending(self) -> float:
        return E * self.thickness**3 / (12 * (1 - NU**2))


def _solve3(k: list[list[float]], f: list[float]) -> list[float]:
    """Solves the 3 × 3 system k x = f by Cramer's rule."""

    def det(a: list[list[float]]) -> float:
        return (
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        )

    d = det(k)
    out = []
    for j in range(3):
        a = [[f[i] if c == j else k[i][c] for c in range(3)] for i in range(3)]
        out.append(det(a) / d)
    return out


def _strain_vectors(
    shell: Shell, lam: float, n: int
) -> tuple[list[float], list[float], list[float], list[float], list[float], list[float]]:
    """The generalised strains of the term (m, n) as row vectors acting on (A, B, C).

    ε_x, ε_θ, κ_x and κ_θ multiply cos nθ sin λx; γ and the twist ρ multiply sin nθ cos λx.
    Sanders: ε_x = u,x, ε_θ = (v,θ + w)/R, γ = v,x + u,θ/R, κ_x = −w,xx,
    κ_θ = (v,θ − w,θθ)/R², ρ = −2 w,xθ/R + (3/2) v,x/R − u,θ/(2R²), w positive outwards.
    """
    r = shell.radius
    ex = [-lam, 0.0, 0.0]
    eth = [0.0, n / r, 1 / r]
    g = [-n / r, lam, 0.0]
    kx = [0.0, 0.0, lam**2]
    kth = [0.0, n / r**2, n**2 / r**2]
    rho = [n / (2 * r**2), 1.5 * lam / r, 2 * n * lam / r]
    return ex, eth, g, kx, kth, rho


def _stiffness(shell: Shell, lam: float, n: int) -> list[list[float]]:
    """The 3 × 3 stiffness of the term (m, n), from the strain energy per unit area."""
    ex, eth, g, kx, kth, rho = _strain_vectors(shell, lam, n)
    dm, db = shell.membrane, shell.bending
    k = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(3):
            k[i][j] = dm * (
                ex[i] * ex[j]
                + eth[i] * eth[j]
                + NU * (ex[i] * eth[j] + eth[i] * ex[j])
                + (1 - NU) / 2 * g[i] * g[j]
            ) + db * (
                kx[i] * kx[j]
                + kth[i] * kth[j]
                + NU * (kx[i] * kth[j] + kth[i] * kx[j])
                + (1 - NU) / 2 * rho[i] * rho[j]
            )
    return k


@dataclass(frozen=True)
class Load:
    """A load's double Fourier series: q_mn = along(λ_m) × around(n), around the shell the
    cos nθ series or, when ``odd``, the sin nθ series."""

    along: Callable[[float], float]
    around: Callable[[int], float]
    odd: bool


def _band(lam: float, x0: float, c: float) -> float:
    """∫ sin λx dx over |x − x0| < c."""
    return 2 / lam * math.sin(lam * x0) * math.sin(lam * c)


def _band_linear(lam: float, x0: float, c: float) -> float:
    """∫ (x − x0) sin λx dx over |x − x0| < c."""
    return math.cos(lam * x0) * 2 * (math.sin(lam * c) / lam**2 - c * math.cos(lam * c) / lam)


def _arc(n: int, half: float) -> float:
    """(1/π) ∫ cos nθ dθ over |θ| < half, the cos series coefficient of a band (1/2π at n = 0)."""
    return half / math.pi if n == 0 else 2 * math.sin(n * half) / (n * math.pi)


def _arc_linear(n: int, half: float) -> float:
    """(1/π) ∫ θ sin nθ dθ over |θ| < half."""
    return (
        0.0 if n == 0 else 2 * (math.sin(n * half) / n**2 - half * math.cos(n * half) / n) / math.pi
    )


def radial(shell: Shell, p: float, c1: float, c2: float) -> Load:
    """A radial force p (outwards positive) spread evenly over the rectangle."""
    q, x0, half = p / (4 * c1 * c2), shell.length / 2, c1 / shell.radius
    return Load(
        along=lambda lam: q * 2 / shell.length * _band(lam, x0, c2),
        around=lambda n: _arc(n, half),
        odd=False,
    )


def longitudinal_moment(shell: Shell, m: float, c1: float, c2: float) -> Load:
    """A moment m about y, the circumferential direction at the top of the shell, as the
    pressure q = −3 m ξ / (4 c1 c2³), ξ = x − x0 along the shell: an outward q at +ξ on a
    surface facing +z has the moment −ξ q about y."""
    k, x0, half = -3 * m / (4 * c1 * c2**3), shell.length / 2, c1 / shell.radius
    return Load(
        along=lambda lam: k * 2 / shell.length * _band_linear(lam, x0, c2),
        around=lambda n: _arc(n, half),
        odd=False,
    )


def circumferential_moment(shell: Shell, m: float, c1: float, c2: float) -> Load:
    """A moment m about x, the shell's axis, as the pressure q = 3 m s / (4 c2 c1³), s = R θ
    around the shell from the top towards +y: an outward q at +s has the moment +s q about x."""
    k, x0, r = 3 * m / (4 * c2 * c1**3), shell.length / 2, shell.radius
    return Load(
        along=lambda lam: k * 2 / shell.length * _band(lam, x0, c2),
        around=lambda n: r * _arc_linear(n, c1 / r),
        odd=True,
    )


@dataclass(frozen=True)
class Stress:
    """Stresses at a point of the shell, MPa: along (x) and around (θ) the shell, outside and
    inside surface."""

    x_out: float
    theta_out: float
    x_in: float
    theta_in: float


class Series:
    """The shell's response to a unit radial pressure term cos nθ sin λx, for every term."""

    def __init__(self, shell: Shell, terms: int = TERMS, terms_around: int | None = None) -> None:
        self.shell = shell
        self.lams = [m * math.pi / shell.length for m in range(1, terms + 1)]
        self.ns = list(range(0, (terms if terms_around is None else terms_around) + 1))
        dm, db = shell.membrane, shell.bending
        #: Per term: the membrane forces Nx, Nθ and moments Mx, Mθ for unit q (cos nθ sin λx).
        self.unit: list[list[tuple[float, float, float, float]]] = []
        for lam in self.lams:
            row = []
            for n in self.ns:
                a = _solve3(_stiffness(shell, lam, n), [0.0, 0.0, 1.0])
                ex, eth, _, kx, kth, _ = _strain_vectors(shell, lam, n)
                e_x, e_th, k_x, k_th = (
                    sum(v * c for v, c in zip(vec, a, strict=True)) for vec in (ex, eth, kx, kth)
                )
                row.append(
                    (
                        dm * (e_x + NU * e_th),
                        dm * (e_th + NU * e_x),
                        db * (k_x + NU * k_th),
                        db * (k_th + NU * k_x),
                    )
                )
            self.unit.append(row)

    def stresses(self, loads: list[Load], x: float, theta: float) -> Stress:
        """Normal stresses at (x, θ) on both surfaces from the sum of the loads; x from mid-length,
        θ from the top (+z) towards +y."""
        xx = self.shell.length / 2 + x
        # A sin nθ term is the cos nθ term turned by π/(2n), so its fields go with sin nθ.
        around = [
            [
                ld.around(n) * (math.sin(n * theta) if ld.odd else math.cos(n * theta))
                for n in self.ns
            ]
            for ld in loads
        ]
        nx = nth = mx = mth = 0.0
        for lam, row in zip(self.lams, self.unit, strict=True):
            along = [ld.along(lam) * math.sin(lam * xx) for ld in loads]
            for i, (unx, unth, umx, umth) in enumerate(row):
                q = sum(a * ar[i] for a, ar in zip(along, around, strict=True))
                nx += q * unx
                nth += q * unth
                mx += q * umx
                mth += q * umth
        t = self.shell.thickness
        return Stress(
            x_out=nx / t + 6 * mx / t**2,
            theta_out=nth / t + 6 * mth / t**2,
            x_in=nx / t - 6 * mx / t**2,
            theta_in=nth / t - 6 * mth / t**2,
        )


def self_check() -> list[tuple[str, float, float]]:
    """Two closed-form cases the series must reproduce: (name, series, exact)."""
    rows = []
    shell = Shell(radius=300.0, thickness=10.0, length=3000.0)
    # The whole length under uniform outward pressure, around the whole circumference: away
    # from the ends σθ = q R / t. Only n = 0 is loaded.
    series = Series(shell, terms=2000, terms_around=0)
    whole = radial(shell, 1.0 * (2 * math.pi * 300.0) * 3000.0, math.pi * 300.0, 1500.0)
    rows.append(
        (
            "Uniform pressure 1 MPa, hoop stress (MPa)",
            series.stresses([whole], 0.0, 0.0).theta_out,
            30.0,
        )
    )
    # A band of pressure q, 2c long, around a long shell: under its middle
    # Mx = q / (2β²) e^(−βc) sin βc (Timoshenko, beam on an elastic foundation).
    q, c = 1.0, 20.0
    band = radial(shell, q * 2 * math.pi * 300.0 * 2 * c, math.pi * 300.0, c)
    beta = (3 * (1 - NU**2) / (300.0**2 * 10.0**2)) ** 0.25
    moment = q / (2 * beta**2) * math.exp(-beta * c) * math.sin(beta * c)
    got = series.stresses([band], 0.0, 0.0).x_out
    rows.append(
        ("Band of 1 MPa, 40 mm long, axial stress at the outside (MPa)", got, 6 * moment / 10.0**2)
    )
    # q = q0 cos θ along the whole of a slender shell (L = 20 R) is a beam under w = π R q0 per
    # length: at mid-span the top's axial membrane stress (the mid-surface's) is M / (π R² t)
    # with M = w L² / 8.
    slender = Shell(radius=300.0, thickness=10.0, length=6000.0)
    series = Series(slender, terms=400, terms_around=1)
    q0 = 0.01
    beam = Load(
        along=lambda lam: q0 * 2 / slender.length * _band(lam, 3000.0, 3000.0),
        around=lambda n: 1.0 if n == 1 else 0.0,
        odd=False,
    )
    m_mid = math.pi * 300.0 * q0 * 6000.0**2 / 8
    top = series.stresses([beam], 0.0, 0.0)
    got = (top.x_out + top.x_in) / 2
    rows.append(
        (
            "Beam load 0.01 cos θ MPa, axial membrane stress at mid-span (MPa)",
            got,
            m_mid / (math.pi * 300.0**2 * 10.0),
        )
    )
    return rows


@dataclass(frozen=True)
class Attachment:
    name: str
    shell: Shell
    r0: float  # attachment radius
    arm: float  # from the shell's mid-surface at the attachment to the piping load's point


#: Piping load on the nozzle end (spec.json): force (N) and moment (N·mm) at (0, 0, 560) mm.
FORCE = (4e3, -3e3, -6e3)
MOMENT = (2e6, 3e6, 1.5e6)
NOZZLE_END_Z = 560.0

#: The two places WRC 107 checks a padded nozzle: at the pad's edge the plain shell, with the
#: pad as the attachment, and at the nozzle's edge the shell and pad together (t = 20 mm).
ATTACHMENTS = (
    Attachment(
        "Pad edge",
        Shell(radius=305.0, thickness=10.0, length=1200.0),
        r0=165.0,
        arm=NOZZLE_END_Z - 305.0,
    ),
    Attachment(
        "Nozzle edge",
        Shell(radius=310.0, thickness=20.0, length=1200.0),
        r0=83.0,
        arm=NOZZLE_END_Z - 310.0,
    ),
)

#: Internal pressure, MPa, for the membrane stresses WRC 107 adds to the local ones.
PRESSURE = 2.0


def junction_loads(arm: float) -> dict[str, float]:
    """The piping load moved to the shell: P radial (outwards), VL along, VC around the shell,
    ML about y (longitudinal), MC about x (circumferential), MT about z (torsion)."""
    fx, fy, fz = FORCE
    mx, my, mz = MOMENT
    # M at the shell = M + r × F, with r = (0, 0, arm) from the shell to the load's point.
    return {"P": fz, "VL": fx, "VC": fy, "MC": mx - arm * fy, "ML": my + arm * fx, "MT": mz}


def analyse(
    attachment: Attachment, offsets: tuple[float, ...] = (0.0,), terms: int = TERMS
) -> dict[str, object]:
    """Stresses at WRC 107's points A, B (along the shell) and C, D (around it), at the edge of
    the equivalent square, and that far plus each other offset in mm."""
    shell = attachment.shell
    c = 0.875 * attachment.r0
    loads = junction_loads(attachment.arm)
    parts = {
        "P": radial(shell, loads["P"], c, c),
        "ML": longitudinal_moment(shell, loads["ML"], c, c),
        "MC": circumferential_moment(shell, loads["MC"], c, c),
    }
    series = Series(shell, terms)
    t, r0 = shell.thickness, attachment.r0
    shear = {
        "VC": abs(loads["VC"]) / (math.pi * r0 * t),  # largest at A and B
        "VL": abs(loads["VL"]) / (math.pi * r0 * t),  # largest at C and D
        "MT": abs(loads["MT"]) / (2 * math.pi * r0**2 * t),
    }
    at = {}
    for offset in offsets:
        d = c + offset
        points = {
            "A": (d, 0.0),
            "B": (-d, 0.0),
            "C": (0.0, d / shell.radius),
            "D": (0.0, -d / shell.radius),
        }
        rows = {}
        for name, (x, theta) in points.items():
            per_load = {key: vars(series.stresses([load], x, theta)) for key, load in parts.items()}
            rows[name] = {
                "per_load": per_load,
                "total": vars(series.stresses(list(parts.values()), x, theta)),
            }
        at[f"{offset:g}"] = rows
    membrane = {"hoop": PRESSURE * shell.radius / t, "axial": PRESSURE * shell.radius / (2 * t)}
    return {
        "attachment": attachment.name,
        "shell": vars(shell),
        "r0": r0,
        "square_half_side": c,
        "loads": loads,
        "shear": shear,
        "points": at,
        "pressure_membrane": membrane,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--json", help="write the results here as JSON")
    parser.add_argument("--terms", type=int, default=TERMS, help="series terms each way")
    args = parser.parse_args()

    print("Self-check against closed-form shell results:")
    for name, got, want in self_check():
        print(f"  {name}: series {got:.4f}, exact {want:.4f}, {100 * (got / want - 1):+.2f} %")
    results = [analyse(a, (0.0, 8.0), args.terms) for a in ATTACHMENTS]
    for res in results:
        shell = res["shell"]
        print(f"\n{res['attachment']}: R {shell['radius']}, t {shell['thickness']}, r0 {res['r0']}")
        print("  loads at the shell: " + ", ".join(f"{k} {v:.0f}" for k, v in res["loads"].items()))
        print("  shear stress (MPa): " + ", ".join(f"{k} {v:.2f}" for k, v in res["shear"].items()))
        print("  Piping load only, MPa, at the equivalent square's edge (+0) and 8 mm beyond:")
        print("  | Point | σx out | σθ out | σx in | σθ in |")
        print("  | --- | --- | --- | --- | --- |")
        for offset, rows in res["points"].items():
            for name, row in rows.items():
                v = row["total"]
                cells = " | ".join(
                    f"{v[k]:.1f}" for k in ("x_out", "theta_out", "x_in", "theta_in")
                )
                print(f"  | {name} +{offset} | {cells} |")
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
