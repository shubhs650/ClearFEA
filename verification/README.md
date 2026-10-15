# verification

Verification cases with reference values, and the harness that runs them (`make verify`). Why and which cases: `docs/VERIFICATION.md`. How the harness works: ADR-035.

```
make verify BUILD_CA=/root/.ccr/ca-bundle.crt        # coarse tier, all cases (BUILD_CA only behind the cloud proxy)
VERIFY_TIER=full CASES="V-01" make verify             # full tier, one case
```

`infra/verify.sh` starts a fresh API on :8788 with an empty local database and a worker container, runs `python -m harness` from this folder with the worker's uv environment, prints the result table and stops both. Logs, `results.md` and `results.json` go to the folder it names at the end. The exit status is 1 if any check fails.

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
- `checks`: each has a `name`, a `quantity` (`vonMises`, `displacement`, `displacement.x`/`.y`/`.z`, or `displacement.radial` about the z axis), the `face` it is read on, an optional `box` (in the geometry's unit) that limits it to part of the face, a `reference` with its unit, and a relative `tolerance` per tier. The computed value is the mean over the run's surface vertices on that face inside the box, read from the run's `surface.bin` and `fields.bin`.
- `allowedWarnings`: optional regular expressions for solver log lines that may contain "warning".

Every case also gets the automatic checks: the STEP unit detected, reactions balancing the applied loads within 0.1 percent (pressures, forces, remote loads' forces, and gravity and centrifugal loads on the volume the run's surface encloses), no unexpected solver warnings, and billed seconds with one ledger entry.

A tolerance is never loosened to make a case pass without a written reason in `reference.md` (docs/VERIFICATION.md).
