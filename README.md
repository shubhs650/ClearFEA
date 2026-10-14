# ClearFEA

Open cloud finite element analysis with published, compute-based pricing.

ClearFEA lets an engineer upload a STEP file, set up a structural or thermal analysis in the browser, run it on CalculiX, inspect the results and export a report. It is built for working engineers who know FEA basics and do not have a commercial licence.

**Status: pre-alpha.** Phase 0 (a fully working localhost prototype) is in progress. Nothing here is usable yet. See [docs/PROGRESS.md](docs/PROGRESS.md).

## What it will do at the Phase 0 gate

- Linear static, modal, steady-state thermal and thermal stress analysis
- STEP solids, single part or multi-body with auto-detected bonded interfaces
- Loads and supports an engineer expects: pressure, force, remote force and moment, hydrostatic pressure, gravity, centrifugal load, elastic supports, symmetry, convection, radiation and more
- Automatic meshing with local refinement, shown before you run, with a size and cost estimate
- Per-field units with a project default
- Results with a reaction balance check, cut planes, probes and CSV/VTK export
- A structured report in PDF and Word
- The exact solver input and log for every run, downloadable, so any run can be reproduced on your own CalculiX install

## What it will not do yet

No fluids, no nonlinear analysis, no shells or beams, no geometry editing. The full list is in [docs/DECISIONS.md](docs/DECISIONS.md#non-goals-for-phase-0-and-the-beta).

## Principles

- **Clear pricing.** The hosted service will charge per second of machine time at published rates, with an estimate before every run.
- **Clear results.** Solver input, logs, versions and verification errors are all visible.
- **Open.** AGPL v3. Self-hosting on your own hardware is a supported, documented, free option.
- **A tool, not a verdict.** ClearFEA is a general-purpose analysis tool. It does not certify designs or check code compliance. Engineering decisions remain with a qualified engineer.

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Product decisions, scope and non-goals |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and technology choices |
| [docs/PLAN.md](docs/PLAN.md) | Milestones, tasks and exit criteria |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current status and session log |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Benchmark cases and test tiers |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute, DCO sign-off |
| [CLAUDE.md](CLAUDE.md) | Working instructions for Claude Code sessions |

## Running it

Requirements: Docker (with the daemon running), Node.js 22 with pnpm, and `uv` (which provides Python 3.12).

```
make install   # TypeScript and Python dependencies
make dev       # API on :8787, web app on http://localhost:5173, worker in Docker; Ctrl-C stops all
make test      # fast test tier: generated-code check, unit tests, type checks, lint
```

Open http://localhost:5173 and sign in as a local test user: `alice` / `alice-local` or `bob` / `bob-local`. The first `make dev` builds the worker image, which takes a few minutes. Behind a TLS-intercepting proxy, pass its CA bundle: `make dev BUILD_CA=/path/to/ca-bundle.crt`.

## Licence

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

ClearFEA builds on [CalculiX](https://www.calculix.de/), [Gmsh](https://gmsh.info/) and [OpenCASCADE](https://dev.opencascade.org/), each under its own licence.
