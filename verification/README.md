# verification

Verification cases with reference values, and the harness that runs them (`make verify`). Why and which cases: `docs/VERIFICATION.md`. How the harness works: ADR-035.

```
make verify BUILD_CA=/root/.ccr/ca-bundle.crt        # coarse tier, all cases (BUILD_CA only behind the cloud proxy)
VERIFY_TIER=full CASES="V-01" make verify             # full tier, one case
```

`infra/verify.sh` starts a fresh API on :8788 with an empty local database and a worker container, runs `python -m harness` from this folder with the worker's uv environment, prints the result table and stops both. Logs, `results.md` and `results.json` go to the folder it names at the end. The exit status is 1 if any check fails.

## Acceptance models

`acceptance/` holds the two acceptance models of `docs/VERIFICATION.md` (M9.4): `A-nozzle-on-shell` and `B-flanged-pipe-thermal`. Each is a case folder like those below, with `model.md` (the design, the setup and what the hand checks can use) in place of `reference.md`. They are not part of the default suite; name them to run them: `CASES="A B" make verify`. M9.5 and M9.6 add their acceptance checks to the same `case.yaml` files.

## Results page

`docs/VERIFICATION_RESULTS.md`, the published results page every report links to, is written by `python -m harness.page` from the result tables in `results/` (the phase-end run's for the V cases, a local full-tier run's for A and B; `sources.json` names each run). How to refresh it: `docs/VERIFICATION.md`, Published results.

## A case

```
cases/V-01-thick-cylinder/
  case.yaml        id, title, unit, named faces, mesh size per tier, checks and tolerances
  geometry.py      writes the STEP file: python geometry.py OUT.step (Gmsh, no binary files committed)
  spec.json        the SimulationSpec, faces by name, values in deliberately mixed units
  reference.md     how the reference values follow, with sources, and why each tolerance is what it is
```

`case.yaml`:

- `geometry.unit`: the length unit the STEP file declares; the harness checks it was detected and confirms it.
- `faces`: each face the case uses, by its bounding box (`min`, `max`) in that unit. The harness finds the one face of `topology.json` with that box (within 0.01 of the unit) and puts its tag into `spec.json` in place of the name.
- `mesh.coarse`, `mesh.full`: the global mesh size for each tier, replacing the one in `spec.json`.
- `checks`: each has a `name`, a `quantity` (`vonMises`, `displacement`, `displacement.x`/`.y`/`.z`, `displacement.radial` about the z axis, a stress or strain component `stress.xx` … `stress.zx` and `strain.xx` … `strain.zx` (tensor shear strains, half of γ), a principal stress `principal.1`/`.2`/`.3`, σ1 ≥ σ2 ≥ σ3, or, for a steady-state thermal or a thermal stress case, the absolute `temperature`, M5.1, or, for a modal case, the `frequency` of the check's `mode`, counted from 1, M6.1, or a component of that mode's shape `modeShape.x`/`.y`/`.z`, scaled to a largest displacement of 1 and signed as ADR-071 says, M6.2), the `face` it is read on (or, for a support's reaction force `reaction.x`/`.y`/`.z` or its reaction moment about the centroid of its faces `moment.x`/`.y`/`.z`, the spec's `support` id instead), an optional `box` (in the geometry's unit) that limits it to part of the face, a `reference` with its unit, and a relative `tolerance` per tier. The computed value is the mean over the run's surface vertices on that face inside the box, read from the run's `surface.bin` and `fields.bin`. A check with `inside: true` names no face but a `box`, and is the mean over every mesh node inside that box, interior nodes included, read from the run's `mesh.bin` and `nodes.bin` (M3.4, the values a cut plane draws); a case with such a check also gets an automatic check that each field the API serves on its own equals the whole `nodes.bin`.
- A `frequency` check names no face: it reads the run's own `frequencies` at its `mode`. Its error is relative to the reference, or, with `relativeTo: N`, the difference from the reference over the run's frequency of mode N, which a reference of zero needs (a rigid-body mode of V-22 is checked as a share of the first elastic frequency).
- `allowedWarnings`: optional regular expressions for solver log lines that may contain "warning".

Every case also gets the automatic checks: the STEP unit detected, reactions balancing the applied loads within 0.1 percent (pressures, forces, remote loads' forces, hydrostatic pressures, and gravity and centrifugal loads on the volume the run's surface encloses; with no applied load, measured against the larger of the reactions' sizes and the run's own sum of the supports' nodal force sizes, ADR-067 item 6), the run's own balance check (force and moment, ADR-051) within the same 0.1 percent (both left out for a steady-state thermal case, which has no forces; a thermal stress case, M5.4, gets them and the heat balance), no unexpected solver warnings, and billed seconds with one ledger entry. After the last case, the "Ledger" rows check that the harness user's ledger, the costs its runs recorded and the wallet agree to the micro-credit over the whole run (M8 exit). The harness reads everything through the API, never the API's database file (ADR-090).

A tolerance is never loosened to make a case pass without a written reason in `reference.md` (docs/VERIFICATION.md).
