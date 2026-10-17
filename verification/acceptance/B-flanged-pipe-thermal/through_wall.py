# SPDX-License-Identifier: AGPL-3.0-or-later
"""Acceptance case B (M9.6): closed-form through-wall temperatures and thermal stresses of the
long thick cylinder that the flanged pipe is away from its flange.

    python3 through_wall.py [--json OUT.json]

Plain Python, no dependencies. The values come from the case's own round numbers (`model.md`):

- Wall: bore a = 100 mm, outside b = 150 mm. Convection 2000 W/(m²·K) to 280 °C in the bore and
  500 W/(m²·K) to 30 °C outside.
- Conductivity, Young's modulus and the mean expansion coefficient (from 20 °C) each linear
  between 20 °C and 300 °C: k 50 to 44 W/(m·K), E 200 to 182 GPa, α 11.5 to 12.9 µm/(m·K);
  ν = 0.3. Stress-free at 20 °C, so the thermal strain is ε(T) = α(T) (T − 20) (ADR-068 item 4).

Temperatures. With k linear in T the Kirchhoff variable φ(T) = ∫ k dT is logarithmic in r for
steady radial conduction, so the wall's conduction resistance is exactly ln(b/a) / (2π k̄) with k̄
the conductivity at the mean of the two surface temperatures. The bore and outside temperatures
follow from the three resistances in series, and T(r) from inverting φ.

Stresses, two ways, both for a long cylinder whose ends are free to grow (generalised plane
strain, uniform axial strain and no net axial force), which is what the symmetry plane at
z = 0 and the free flange end make of the wall away from the flange:

1. Closed form (Timoshenko and Goodier, Theory of Elasticity, §150, a hollow cylinder with any
   radial temperature, the same integrals written with the thermal strain ε(r) in place of
   α T(r)), with E constant at its value at the mean wall temperature:
       I(r) = ∫_a^r ε ρ dρ,  I_b = I(b),  K = E / (1 − ν)
       σr = K / r² [ (r² − a²) / (b² − a²) I_b − I(r) ]
       σθ = K / r² [ (r² + a²) / (b² − a²) I_b + I(r) − ε r² ]
       σz = K [ 2 I_b / (b² − a²) − ε ]
2. The same problem with E(T) varying through the wall: the radial equilibrium and Hooke's law
   in generalised plane strain integrated across the wall (Runge-Kutta, 4000 steps), with
   σr(a) = σr(b) = 0 and no net axial force. Linear in the two unknowns (the bore's radial
   displacement and the axial strain), so three integrations and a 2 × 2 solve give it.

The script checks its own pieces first: (1) against Timoshenko's logarithmic-temperature
formulas for constant α and E, and (2) against (1) when E is made constant.
"""

import argparse
import json
import math

A, B = 0.100, 0.150  # m
H_IN, T_IN = 2000.0, 280.0  # W/(m²·K), °C
H_OUT, T_OUT = 500.0, 30.0
NU = 0.3
T0 = 20.0  # stress-free temperature and the tables' first row, °C


def lin(t: float, v20: float, v300: float) -> float:
    return v20 + (v300 - v20) * (t - 20.0) / 280.0


class Properties:
    """The material: each property linear in T between its 20 °C and 300 °C values (the case's
    tables), or constant when both are the same (the like-for-like run)."""

    def __init__(self, k: tuple[float, float], e: tuple[float, float], alpha: tuple[float, float]):
        self.k20, self.k300 = k
        self.e, self.alpha = e, alpha

    def k_of(self, t: float) -> float:
        return lin(t, self.k20, self.k300)

    def e_of(self, t: float) -> float:
        return lin(t, *self.e)

    def strain_of(self, t: float) -> float:
        """Thermal strain from the stress-free 20 °C, with α the mean coefficient from 20 °C."""
        return lin(t, *self.alpha) * (t - T0)

    def phi(self, t: float) -> float:
        """Kirchhoff variable ∫_20^T k dT, W/m."""
        s = t - 20.0
        return self.k20 * s + (self.k300 - self.k20) / 280.0 * s * s / 2.0

    def t_of_phi(self, p: float) -> float:
        c = (self.k300 - self.k20) / 560.0  # phi = k20 s + c s²
        if c == 0:
            return 20.0 + p / self.k20
        return 20.0 + (-self.k20 + math.sqrt(self.k20 * self.k20 + 4.0 * c * p)) / (2.0 * c)


CASE = Properties(k=(50.0, 44.0), e=(200e9, 182e9), alpha=(11.5e-6, 12.9e-6))


def surface_temperatures(m: Properties) -> tuple[float, float, float, float]:
    """T(a), T(b), the heat flow per metre of full pipe, and k̄."""
    ta, tb = 230.0, 150.0
    for _ in range(200):
        kbar = m.k_of(0.5 * (ta + tb))
        r_total = (
            1 / (2 * math.pi * A * H_IN)
            + math.log(B / A) / (2 * math.pi * kbar)
            + 1 / (2 * math.pi * B * H_OUT)
        )
        q = (T_IN - T_OUT) / r_total
        ta_new = T_IN - q / (2 * math.pi * A * H_IN)
        tb_new = T_OUT + q / (2 * math.pi * B * H_OUT)
        if abs(ta_new - ta) + abs(tb_new - tb) < 1e-13:
            break
        ta, tb = ta_new, tb_new
    return ta, tb, q, kbar


def temperature_at(m: Properties, r: float, ta: float, tb: float) -> float:
    pa, pb = m.phi(ta), m.phi(tb)
    return m.t_of_phi(pa - (pa - pb) * math.log(r / A) / math.log(B / A))


def simpson(f, lo: float, hi: float, n: int = 2000) -> float:
    if hi <= lo:
        return 0.0
    h = (hi - lo) / n
    s = f(lo) + f(hi)
    for i in range(1, n):
        s += (4 if i % 2 else 2) * f(lo + i * h)
    return s * h / 3


def closed_form(r: float, eps, e: float) -> tuple[float, float, float]:
    """σr, σθ, σz (Pa) at r for a thermal strain field eps(r) and a constant E."""
    k = e / (1 - NU)
    ib = simpson(lambda p: eps(p) * p, A, B)
    ir = simpson(lambda p: eps(p) * p, A, r)
    d = B * B - A * A
    sr = k / (r * r) * ((r * r - A * A) / d * ib - ir)
    st = k / (r * r) * ((r * r + A * A) / d * ib + ir - eps(r) * r * r)
    sz = k * (2 * ib / d - eps(r))
    return sr, st, sz


def varying_e(eps, emod, steps: int = 4000) -> list[tuple[float, float, float, float]]:
    """(r, σr, σθ, σz) across the wall with E = emod(r), generalised plane strain, free ends."""

    def lame(r: float) -> tuple[float, float]:
        e = emod(r)
        return e * NU / ((1 + NU) * (1 - 2 * NU)), e / (2 * (1 + NU))

    def stresses(r: float, u: float, sr: float, ez: float) -> tuple[float, float, float]:
        lam, mu = lame(r)
        eth = eps(r)
        et = u / r
        er = (sr - lam * (et + ez) + (3 * lam + 2 * mu) * eth) / (lam + 2 * mu)
        st = lam * (er + et + ez) + 2 * mu * et - (3 * lam + 2 * mu) * eth
        sz = lam * (er + et + ez) + 2 * mu * ez - (3 * lam + 2 * mu) * eth
        return er, st, sz

    def deriv(r: float, y: tuple[float, float], ez: float, load: float) -> tuple[float, float]:
        u, sr = y
        lam, mu = lame(r)
        eth = load * eps(r)
        et = u / r
        er = (sr - lam * (et + ez) + (3 * lam + 2 * mu) * eth) / (lam + 2 * mu)
        st = lam * (er + et + ez) + 2 * mu * et - (3 * lam + 2 * mu) * eth
        return er, (st - sr) / r

    def integrate(u0: float, ez: float, load: float) -> list[tuple[float, float, float]]:
        h = (B - A) / steps
        r, y = A, (u0, 0.0)
        out = [(r, y[0], y[1])]
        for _ in range(steps):
            k1 = deriv(r, y, ez, load)
            k2 = deriv(r + h / 2, (y[0] + h / 2 * k1[0], y[1] + h / 2 * k1[1]), ez, load)
            k3 = deriv(r + h / 2, (y[0] + h / 2 * k2[0], y[1] + h / 2 * k2[1]), ez, load)
            k4 = deriv(r + h, (y[0] + h * k3[0], y[1] + h * k3[1]), ez, load)
            y = (
                y[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
                y[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
            )
            r += h
            out.append((r, y[0], y[1]))
        return out

    def axial_force(path, ez: float, load: float) -> float:
        def sz_at(r: float, u: float, sr: float) -> float:
            lam, mu = lame(r)
            eth = load * eps(r)
            et = u / r
            er = (sr - lam * (et + ez) + (3 * lam + 2 * mu) * eth) / (lam + 2 * mu)
            return lam * (er + et + ez) + 2 * mu * ez - (3 * lam + 2 * mu) * eth

        h = (B - A) / steps
        vals = [sz_at(r, u, sr) * r for r, u, sr in path]
        s = (
            vals[0]
            + vals[-1]
            + sum((4 if i % 2 else 2) * v for i, v in enumerate(vals[1:-1], start=1))
        )
        return s * h / 3

    # Unknowns x = (u(a), εz); responses σr(b) and N are affine in x.
    base = integrate(0.0, 0.0, 1.0)
    pu = integrate(1e-4, 0.0, 0.0)
    pz = integrate(0.0, 1e-3, 0.0)
    f0 = (base[-1][2], axial_force(base, 0.0, 1.0))
    fu = (pu[-1][2] / 1e-4, axial_force(pu, 0.0, 0.0) / 1e-4)
    fz = (pz[-1][2] / 1e-3, axial_force(pz, 1e-3, 0.0) / 1e-3)
    det = fu[0] * fz[1] - fz[0] * fu[1]
    u0 = (-f0[0] * fz[1] + fz[0] * f0[1]) / det
    ez = (-fu[0] * f0[1] + f0[0] * fu[1]) / det
    path = integrate(u0, ez, 1.0)
    rows = []
    for r, u, sr in path:
        _, st, sz = stresses(r, u, sr, ez)
        rows.append((r, sr, st, sz))
    return rows


def von_mises(sr: float, st: float, sz: float) -> float:
    return math.sqrt(0.5 * ((sr - st) ** 2 + (st - sz) ** 2 + (sz - sr) ** 2))


def self_checks() -> None:
    # (1) Timoshenko's logarithmic-temperature formulas, constant α and E.
    e, alpha, ta, tb = 200e9, 12e-6, 230.0, 150.0
    dt, lnba = ta - tb, math.log(B / A)

    def eps(r: float) -> float:
        return alpha * (tb + dt * math.log(B / r) / lnba - T0)

    c = e * alpha * dt / (2 * (1 - NU) * lnba)
    m = A * A / (B * B - A * A)
    for r in (A, 0.125, B):
        sr, st, sz = closed_form(r, eps, e)
        ref = (
            c * (-math.log(B / r) - m * (1 - B * B / (r * r)) * lnba),
            c * (1 - math.log(B / r) - m * (1 + B * B / (r * r)) * lnba),
            c * (1 - 2 * math.log(B / r) - 2 * m * lnba),
        )
        for got, want in zip((sr, st, sz), ref, strict=True):
            assert abs(got - want) < 1e-6 * abs(c), (r, got, want)
    # (2) the integration with E constant gives the closed form.
    rows = varying_e(eps, lambda r: e)
    for r, sr, st, sz in rows[:: len(rows) // 4]:
        want = closed_form(r, eps, e)
        for got, w in zip((sr, st, sz), want, strict=True):
            assert abs(got - w) < 1e-5 * abs(c), (r, got, w)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json")
    parser.add_argument(
        "--constant",
        metavar="E_GPA,ALPHA_PER_K,K",
        help="constant properties instead of the tables, e.g. 189,12.4e-6,46.3 (like for like)",
    )
    args = parser.parse_args()
    self_checks()
    m = CASE
    if args.constant:
        e_c, a_c, k_c = (float(v) for v in args.constant.split(","))
        m = Properties(k=(k_c, k_c), e=(e_c * 1e9, e_c * 1e9), alpha=(a_c, a_c))
    ta, tb, q, kbar = surface_temperatures(m)
    tmean = 0.5 * (ta + tb)

    def temp(r: float) -> float:
        return temperature_at(m, r, ta, tb)

    def eps(r: float) -> float:
        return m.strain_of(temp(r))

    e_mean = m.e_of(tmean)
    rows = varying_e(eps, lambda r: m.e_of(temp(r)))
    radii = [0.100, 0.1125, 0.125, 0.1375, 0.150]
    out = {
        "T_bore": ta,
        "T_outside": tb,
        "heat_per_metre": q,
        "k_mean": kbar,
        "E_mean": e_mean,
        "points": [],
    }
    print(f"T(a) = {ta:.3f} °C, T(b) = {tb:.3f} °C, ΔT = {ta - tb:.3f} K")
    print(
        f"k̄ = {kbar:.3f} W/(m·K), heat flow {q / 1000:.3f} kW per metre of full pipe,"
        f" {q / 4:.1f} W per metre of the quarter"
    )
    print(f"E at the mean wall temperature {tmean:.2f} °C: {e_mean / 1e9:.3f} GPa\n")
    print(
        "r (mm)  T (°C)  | closed form, E constant: σr σθ σz VM"
        "  | E(T) through the wall: σr σθ σz VM  (MPa)"
    )
    for r in radii:
        cf = closed_form(r, eps, e_mean)
        row = min(rows, key=lambda x: abs(x[0] - r))
        ve = row[1:]
        print(
            f"{r * 1000:6.1f} {temp(r):7.2f} | "
            + " ".join(f"{s / 1e6:8.2f}" for s in (*cf, von_mises(*cf)))
            + " | "
            + " ".join(f"{s / 1e6:8.2f}" for s in (*ve, von_mises(*ve)))
        )
        out["points"].append(
            {
                "r_mm": r * 1000,
                "T": temp(r),
                "closed_form_MPa": {
                    k: v / 1e6
                    for k, v in zip(
                        ("r", "theta", "z", "von_mises"), (*cf, von_mises(*cf)), strict=True
                    )
                },
                "varying_E_MPa": {
                    k: v / 1e6
                    for k, v in zip(
                        ("r", "theta", "z", "von_mises"), (*ve, von_mises(*ve)), strict=True
                    )
                },
            }
        )
    if args.json:
        with open(args.json, "w") as f:
            json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
