# Run estimator fit (M2.12)

The estimate shown before a run (ADR-049) comes from `packages/spec/estimator.json`, which `fit.py` writes from `steps.json`, which `steps.py` measures. Never edit `estimator.json` by hand: change the data or the fit and run `fit.py`; `worker/tests/test_estimator.py` fails when the file is not the fit of the data.

```
cd worker && uv run python benchmarks/solver/steps.py --out /tmp/steps \
    3000:2 12000:2 25000:1 25000:2 100000:1 200000:1 400000:1 50000:2 100000:2 150000:2
cd worker && uv run python benchmarks/solver/fit.py [--check]
```

`steps.py` meshes the M2.11 block (`bench.py`) at each target element count and order, then runs the solve job's steps in the job's order with the worker's own functions: reading the mesh, writing the deck, `run_calculix` with the worker's solver environment (SPOOLES on one thread), reading the results and writing the viewer's files. Each solve is a fresh process, so the peak memory of its child is that solve's. The committed set takes about 40 minutes on 4 cores and needs about 10 GiB for the largest mesh; it needs `ccx` and Gmsh's system libraries on the host.

## `steps.json`

| Field | Meaning |
| --- | --- |
| `targetElements`, `order` | what was asked for |
| `elements`, `nodes` | the mesh actually solved |
| `stepSeconds` | wall time of each step: `readMesh`, `deck`, `writeDeck`, `solver`, `readResults`, `viewerFiles` |
| `jobSeconds` | their sum, the time the estimate predicts |
| `peakMemoryBytes` | peak resident memory of the solver process (`ru_maxrss` of the children) |
| `frdBytes`, `ccxVersion`, `machine`, `date` | the result file's size, CalculiX's version, the host, the day |

## The fit

Both quantities are fitted as `constant + coefficient × nodes^exponent` over all rows, both element orders together. On the committed data the memory law is within 2 percent of every row (and of M2.11's single-threaded SPOOLES rows in `results.json`, measured separately) and the time law within 21 percent. `memoryMargin` (1.25) and `usableMemoryFraction` (0.85) set how much memory a machine size must have before it is recommended.

## Modal runs (M6.3, ADR-072)

```
cd worker && uv run python benchmarks/solver/steps.py --out /tmp/steps --solver spooles \
    --analysis modal --modes 1 3000:2 12000:2 25000:2 50000:2 100000:2 150000:2 25000:1 ...
uv run python benchmarks/solver/steps.py ... --modes 100 ...    # the same meshes again
```

A modal row is the same block held at the same end, with no load, steel's density and `--modes` modes; its rows carry `analysis: "modal"` and `modes` (rows without them are linear static). Each mesh is measured with 1 and with 100 modes. The line through those two rows splits the mesh's memory and time into a part for the mesh and a part per mode; `fit.py` fits each part as a power law over the meshes, and the `largestRatio` of the mesh parts is the worst shortfall of the whole sum over every modal row (also the rows at 10 and 50 modes of the 25,000-element mesh, which lie under the line). Modal element limits are for 100 modes, the most a setup may ask for. Only SPOOLES is measured: modal setups may not use PaStiX (ADR-072) or the iterative solvers (ADR-070). The committed modal set takes about 7 hours, most of it the largest meshes at 100 modes.
