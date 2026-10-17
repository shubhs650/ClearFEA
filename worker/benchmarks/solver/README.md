# Solver benchmark (M2.11) and job-step benchmark (M2.12, ADR-063)

Wall time and peak memory of CalculiX's equation solvers on one part, meshed from about 100,000 elements to the finest mesh ClearFEA makes. Decision and reasoning: ADR-048 in `docs/DECISIONS.md`. The run estimator and the element limits per solver are fitted from `steps.json` (`steps.py`, `fit.py`; ADR-049, ADR-063); `results.json` is M2.11's record of the packaged build and the hand-built PaStiX.

## Job steps per solver (ADR-063)

```
export PATH=<dir with the worker image's ccx>:$PATH    # built by worker/ccx/build.sh
cd worker && uv run python benchmarks/solver/steps.py --out DIR --solver pastix 3000:2 25000:1 ...
uv run python benchmarks/solver/fit.py                  # rewrites packages/spec/estimator.json
```

`steps.json` holds the solve job's steps for `pastix`, `spooles`, `iterative_cholesky` and `iterative_scaling`, measured with `worker/ccx/build.sh`'s build on the host (the image's build script, same source and pins), the worker's solver environment (one thread), up to 500,000 elements (PaStiX 4-node to 1.1 million). `fit.py` writes a memory and time law per solver and each solver's `maxElements` per element order on 16 GiB; see ADR-063 item 5 for how the sandbox's 13.4 GiB measurements give 16 GB limits. Run the larger meshes one solver at a time: the largest SPOOLES mesh takes 40 minutes. Since M6.3 it also holds SPOOLES modal rows (`--analysis modal --modes N`), each mesh at 1 and 100 modes, which `fit.py` turns into the modal model and limits (ADR-072; `estimator.md`).

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

- **PaStiX above 207,000 nodes.** The PaStiX build crashed (SIGSEGV) at 331,000 nodes; see PaStiX below.
- **SPOOLES above 207,000 nodes.** On one thread it solved 145,471 elements (207,025 nodes) in 8.8 GiB and was not tried higher. On 4 threads, at 331,000 nodes (235,000 elements) it passed the script's limit of 11.4 GiB (85 percent of the sandbox's 13.4 GiB control group) after 275 s and was stopped; an earlier attempt without that limit was killed by the kernel at 13.4 GiB. It was not tried on larger meshes.
- **Iterative scaling at the finest mesh.** It took 3,479 s at 945,000 elements, about 3.5 times iterative Cholesky, and would pass the 2-hour limit; it was not run.

## PaStiX

Rows with `build` `ccx-2.21-pastix4calculix` (PaStiX's default mixed precision: single-precision factorisation refined to double accuracy by GMRES) and `ccx-2.21-pastix4calculix-double` (`PASTIX_MIXED_PRECISION=0`). Its largest displacement and von Mises stress equal SPOOLES's on every mesh both solved.

| Elements | SPOOLES, 1 thread | PaStiX, 4 threads | PaStiX double, 4 threads |
| --- | --- | --- | --- |
| 24,989 | 42 s, 0.87 GiB | 21 s, 1.35 GiB | |
| 50,229 | 156 s, 2.16 GiB | 53 s, 3.06 GiB | 89 s, 5.24 GiB |
| 97,439 | 574 s, 5.32 GiB | 133 s, 6.73 GiB (1 thread: 111 s, 6.67 GiB) | over 11.4 GiB, stopped |
| 145,471 | 1,273 s, 8.84 GiB | 218 s, 11.05 GiB | |
| 235,197 | | crashed after 51 s at 4.6 GiB | |

So PaStiX is 4 to 6 times faster than single-threaded SPOOLES for about 1.25 times the memory; it does not solve larger meshes on the same memory. One thread was faster than four at 97,439 elements on this 4-core machine. The crash at 235,197 elements (331,105 nodes, 81.6 million matrix entries) is most likely 32-bit integer overflow: this build uses 32-bit integers, and CalculiX's own recipe for PaStiX (`Makefile_i8`) builds everything with 64-bit integers. That was not tried here (it needs 64-bit-integer SPOOLES, ARPACK, Scotch and BLAS too).

`make verify` (coarse tier) with this ccx as the worker image's `ccx` passed all 13 cases, 116 of 116 checks; the build's default solver is then PaStiX, run on one thread because the worker sets `CCX_NPROC_EQUATION_SOLVER=1`. Twenty repeat solves of the support-check decks on 4 threads matched single-threaded SPOOLES to about 1e-12, so PaStiX does not share threaded SPOOLES's wrong answers.

### How the PaStiX build was made

Since ADR-063 the worker image builds it with `worker/ccx/build.sh` (from Ubuntu's ccx source package, shared PaRSEC, Python 3.12, `worker/ccx/pastix4calculix.patch`); the steps below are M2.11's by-hand build, kept as the record of what was measured then.

Done by hand in the Claude Code sandbox (Ubuntu 24.04, gcc 13); not a script, and not in the worker image.

1. Packages: `gfortran libopenblas-dev liblapacke-dev libhwloc-dev libscotch-dev libspooles-dev libarpack2-dev pkg-config nvidia-cuda-toolkit g++-12`. The fork includes CUDA and PaRSEC headers unconditionally, so CUDA is needed to compile and link even without a GPU.
2. PaRSEC: `git clone https://bitbucket.org/mfaverge/parsec.git`, tag `pastix-6.0.2` (`b580d208`); `cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DPARSEC_DIST_WITH_MPI=OFF -DPARSEC_GPU_WITH_CUDA=ON -DPARSEC_GPU_WITH_OPENCL=OFF -DPARSEC_WITH_DEVEL_HEADERS=ON -DSUPPORT_FORTRAN=OFF -DCMAKE_C_FLAGS=-fcommon`.
3. PaStiX4CalculiX: `git clone https://github.com/Dhondtguido/PaStiX4CalculiX` at `d6b493b`, then `git apply` the patch now at `worker/ccx/pastix4calculix.patch` minus its `import imp` change (then beside this file: drops `-march=native`, targets `sm_52` because CUDA 12 has no `sm_35`, accepts CMake's `Threads::Threads` target, and sends the code generator's warnings to stderr, where they no longer corrupt the generated Makefiles). Configure with `SCRIPT_OUT="-fcommon -O2" cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DPASTIX_INT64=OFF -DPASTIX_WITH_PARSEC=ON -DPARSEC_DIR=<parsec> -DPASTIX_WITH_CUDA=ON -DCUDA_HOST_COMPILER=/usr/bin/gcc-12 -DPASTIX_WITH_MPI=OFF -DPASTIX_ORDERING_SCOTCH=ON -DPASTIX_WITH_FORTRAN=OFF -DBLA_VENDOR=OpenBLAS -DPYTHON_EXECUTABLE=/usr/bin/python3.11` (its generator uses Python's `imp`, gone in 3.12).
4. CalculiX 2.21 from `http://www.dhondt.de/ccx_2.21.src.tar.bz2`, built with CalculiX's `Makefile` plus `-fcommon -DPASTIX` and the PaStiX and PaRSEC include paths, `-fallow-argument-mismatch` for gfortran, and linked against the PaStiX static libraries, `-lparsec -lscotch -lscotcherrexit -lhwloc -llapacke -lopenblas -lcublas -lcudart -lcusparse -lstdc++`.

Then `bench.py --ccx <that ccx> --build ccx-2.21-pastix4calculix --solvers PASTIX --threads 4`; the SPOOLES comparison is taken from the single-threaded SPOOLES rows already in `results.json`.

## Accuracy of the iterative solvers

CalculiX stops both iterative solvers at a relative residual of 1e-4, fixed in its source (`preiter.c`, `eps=1.e-4`), with no keyword to tighten it. On the block, iterative Cholesky's largest displacement was 0.098 percent from SPOOLES's and iterative scaling's 0.002 percent. To see what that means for real setups, `make verify` (coarse tier) was run once with every deck naming each iterative solver (a local experiment, not committed; `ccx` had 4 threads for matrix set-up and stresses, which the iterative solvers do not use):

| Solver | Cases passing | Checks that failed |
| --- | --- | --- |
| SPOOLES (the build's default) | 13 of 13 | none |
| ITERATIVE CHOLESKY | 7 of 13 | reaction balance on V-02, V-03, V-04, V-08, V-24, V-26 (0.11 to 0.45 percent against 0.1); V-08 support force 0.24 percent; V-24 stress, contraction and support force 0.14 to 0.35 percent |
| ITERATIVE SCALING | 11 of 13 | V-08 support forces 0.24 and 0.32 percent; V-24 stress, contraction, support force and reaction balance 0.16 to 0.41 percent |

Both are a few tenths of a percent off where a setup has prescribed displacements (V-24) or a constrained temperature change (V-08), more than the 0.1 percent the verification cases demand of every run.
