# Solver benchmark (M2.11)

Wall time and peak memory of CalculiX's equation solvers on one part, meshed from about 100,000 elements to the finest mesh ClearFEA makes. Decision and reasoning: ADR-048 in `docs/DECISIONS.md`. M2.12's run-time estimator is fitted from `results.json`.

```
cd worker && uv run python benchmarks/solver/bench.py --out /tmp/bench [--targets 100000 250000]
    [--solvers SPOOLES "ITERATIVE CHOLESKY" "ITERATIVE SCALING"] [--threads 4]
    [--ccx /path/to/ccx --build NAME] [--memory-limit-gb 12.9] [--time-limit-s 7200]
```

Needs `ccx` and Gmsh's system libraries on the host, like the spikes. The worker's own mesher and deck generator make every mesh and deck; only the `SOLVER=` on the `*STATIC` line differs between solvers.

## The model

A steel block, 100 × 100 × 50 mm (E 200 GPa, ν 0.3), held on the x = 0 face and pressed with 10 MPa on the x = 100 mm face; second-order tetrahedra (C3D10). A stocky block is the hard case for a direct solver: its matrix fills in about as much as any part of that size. Slender parts of the same element count need less time and memory from SPOOLES; the iterative solvers care less about shape.

Mesh sizes are picked so the element count lands near each target. The "2,000,000" target is the finest mesh the mesher accepts (its pre-mesh estimate is at the 2 million cap), which on this block is 1,520,649 elements.

## `results.json`

One row per mesh, solver, build and thread count, in SI units:

| Field | Meaning |
| --- | --- |
| `targetElements`, `elements`, `nodes`, `dof` | the target, and the mesh actually solved (`dof` = 3 × nodes) |
| `meshSizeMetres`, `meshSeconds` | global mesh size; Gmsh's wall time (null when the mesh was reused from an earlier run of the script) |
| `solver`, `build`, `ccxVersion`, `threads` | `SOLVER=` value, the CalculiX build, its version, and `OMP_NUM_THREADS` |
| `status` | `ok`, `out_of_memory` (killed by the kernel), `memory_limit` or `time_limit` (stopped by the script), `failed` |
| `wallSeconds`, `cpuSeconds`, `ccxReportedSeconds`, `peakMemoryBytes` | the ccx process: wall time, user + system CPU, "Total CalculiX Time", peak resident memory (`ru_maxrss`) |
| `largestDisplacementMetres`, `largestVonMisesPascals` | from the `.frd` (nodal values) |
| `displacementDifferenceToSpooles`, `vonMisesDifferenceToSpooles` | relative difference to SPOOLES on the same mesh, where SPOOLES solved it |
| `machine` | cores, RAM, CPU model, kernel, control group memory limit |

Rows from before the stress check was added (250k to 1M elements, iterative) have no von Mises values.

## Threads

`--threads N` sets `OMP_NUM_THREADS` and `CCX_NPROC_EQUATION_SOLVER` to N. Runs use SPOOLES on one thread (ADR-048 item 3): ccx 2.21's multithreaded SPOOLES sometimes returns a wrong solution, so the 4-thread SPOOLES rows are kept only to show what threads would cost and save (2.1 times faster, 1.8 times the memory at 97,000 elements). The iterative solvers run on one thread either way. Single-thread rows cover SPOOLES from 25,000 to 145,000 elements; 145,471 elements took 8.8 GiB, close to the sandbox's limit.

## What was not measured, and why

- **PaStiX.** CalculiX 2.21's PaStiX interface needs the CalculiX fork of PaStiX (`IPARM_REUSE_LU` and friends), published only at github.com/Dhondtguido/PaStiX4CalculiX. The Claude Code sandbox's network policy refuses that host, and upstream PaStiX (gitlab.inria.fr) would need CalculiX's interface patched. To add it: build `ccx_2.21_i8` with the fork as its `Makefile_i8` describes, then run this script with `--ccx` pointing at it and `--build ccx-2.21-pastix`.
- **SPOOLES above 207,000 nodes.** On one thread it solved 145,471 elements (207,025 nodes) in 8.8 GiB and was not tried higher. On 4 threads, at 331,000 nodes (235,000 elements) it passed the script's limit of 11.4 GiB (85 percent of the sandbox's 13.4 GiB control group) after 275 s and was stopped; an earlier attempt without that limit was killed by the kernel at 13.4 GiB. It was not tried on larger meshes.
- **Iterative scaling at the finest mesh.** It took 3,479 s at 945,000 elements, about 3.5 times iterative Cholesky, and would pass the 2-hour limit; it was not run.

## Accuracy of the iterative solvers

CalculiX stops both iterative solvers at a relative residual of 1e-4, fixed in its source (`preiter.c`, `eps=1.e-4`), with no keyword to tighten it. On the block, iterative Cholesky's largest displacement was 0.098 percent from SPOOLES's and iterative scaling's 0.002 percent. To see what that means for real setups, `make verify` (coarse tier) was run once with every deck naming each iterative solver (a local experiment, not committed; `ccx` had 4 threads for matrix set-up and stresses, which the iterative solvers do not use):

| Solver | Cases passing | Checks that failed |
| --- | --- | --- |
| SPOOLES (the build's default) | 13 of 13 | none |
| ITERATIVE CHOLESKY | 7 of 13 | reaction balance on V-02, V-03, V-04, V-08, V-24, V-26 (0.11 to 0.45 percent against 0.1); V-08 support force 0.24 percent; V-24 stress, contraction and support force 0.14 to 0.35 percent |
| ITERATIVE SCALING | 11 of 13 | V-08 support forces 0.24 and 0.32 percent; V-24 stress, contraction, support force and reaction balance 0.16 to 0.41 percent |

Both are a few tenths of a percent off where a setup has prescribed displacements (V-24) or a constrained temperature change (V-08), more than the 0.1 percent the verification cases demand of every run.
