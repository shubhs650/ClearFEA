<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Acceptance case B: thermal stress in a thick-walled flanged pipe

The model for acceptance case B (docs/VERIFICATION.md, "Acceptance cases"), built in M9.4. M9.6
sets it up through the UI on the laptop, does the closed-form through-wall checks and the
FreeCAD FEM run. Everything here is an original design made for this project, and the material
values are round case values chosen for it, not taken from a code table or a handbook, so the
model can be published.

## Geometry (`geometry.py`, millimetres)

A quarter (between the half-planes x = 0 and y = 0) of one half of an 800 mm long flanged
spool, cut at its mid-length plane z = 0:

- Pipe: bore radius a = 100, outside radius b = 150 (a 50 mm wall, b/a = 1.5), from z = 0 to 400.
- Flange: an integral collar of outside radius 230 from z = 340 to the end face at z = 400.

One body, named "Flanged pipe" in the STEP file. `uv run --directory worker python ../verification/acceptance/B-flanged-pipe-thermal/geometry.py B.step`
writes the file. The wall's decay length √(R t) is 79 mm, so the flange's effect has died
out about 2.5 √(R t) ≈ 200 mm from it: below z ≈ 140 mm the wall is a long thick cylinder.

## Setup (`spec.json`)

Analysis type: thermal stress (ADR-067), which solves the steady heat transfer step and then
the static step on its temperatures in one run. Stress-free temperature 20 °C.

| Item | Faces | Value |
| --- | --- | --- |
| Material "Carbon steel (case tables)" | | E 200 GPa at 20 °C to 182 GPa at 300 °C; ν = 0.3; mean expansion from 20 °C, 11.5 µm/(m·K) at 20 °C to 12.9 at 300 °C; conductivity 50 W/(m·K) at 20 °C to 44 at 300 °C; each linear between its two rows |
| Frictionless "Mid-length plane" | z = 0 | symmetry of the spool's two halves |
| Frictionless "Symmetry plane x = 0", "Symmetry plane y = 0" | the two cut faces | quarter symmetry |
| Convection "Hot fluid in the bore" | bore | 2000 W/(m²·K) to 280 °C |
| Convection "Cooling on the outside" | pipe outside, flange back, flange rim, flange end face | 500 W/(m²·K) to 30 °C |
| Mesh | | 10 mm, quadratic (coarse tier); 6 mm (full tier) |

The flange's end face is free, so the pipe can grow along its axis: away from the flange the
wall is in generalised plane strain with no net axial force.

## What the hand checks can use

- **Temperatures.** With conductivity linear in temperature, the radial heat flow through the
  wall is exactly that of the conductivity at the mean wall temperature (Kirchhoff transform).
  Solving the three resistances in series per metre of pipe, 1 / (2π a hᵢ) + ln(b/a) / (2π k̄)
  + 1 / (2π b hₒ), gives k̄ = 46.28 W/(m·K), a heat flow of 57.98 kW per metre of full pipe,
  T(a) = 233.86 °C at the bore and T(b) = 153.03 °C at the outside (80.8 K across the wall),
  and T(r) between them follows from the same transform (logarithmic in r for constant k).
  `case.yaml` checks both surface temperatures near z = 0; the coarse run gives 233.86 and
  153.02 °C. On the cut y = 0 it gives σθ = −164 MPa at the bore and +124 MPa at the outside,
  with σz close to σθ at both surfaces, as free ends make it.
- **Through-wall stresses.** The closed-form thick-cylinder thermal stresses (Timoshenko and
  Goodier, long cylinder with free ends) with properties at the wall's temperatures; with E
  and α each varying by about 3 percent over the wall, the constant-property form evaluated at
  the mean temperature is the first estimate, and how far the run is from it is part of what
  M9.6 records.
- **Balances.** The heat in through the bore equals the heat out through the cooled faces, and
  the frictionless supports carry no net force (no structural load is applied).

## Known limits that apply (accepted ADRs)

- Tables hold their end values outside their range (ADR-068); the solved temperatures, about
  150 to 235 °C, are inside it.
- One stress-free temperature for the model (ADR-067), and expansion coefficients are mean
  values from 20 °C, which is also the stress-free temperature, so the thermal strain is
  α(T) (T − 20 °C).
- The material library has no conductivity (ADR-064), so the whole material is entered by hand.
