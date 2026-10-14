# Progress

Current state of the project. Update this file at the end of every working session.

## Now

- **Phase:** 0 (localhost prototype)
- **Current milestone:** M0 Bootstrap
- **Next task:** M0.1 Confirm Docker works in the Claude Code cloud environment
- **Blocked on:** nothing

## Milestones

| # | Milestone | Status | Closed on |
| --- | --- | --- | --- |
| M0 | Bootstrap | Not started | |
| M1 | Thin slice | Not started | |
| M2 | Structural setup | Not started | |
| M3 | Results tools | Not started | |
| M4 | Assemblies | Not started | |
| M5 | Thermal | Not started | |
| M6 | Modal | Not started | |
| M7 | Report | Not started | |
| M8 | Platform | Not started | |
| M9 | Gate | Not started | |

Status values: Not started, In progress, Verifying, Done.

## Current milestone tasks

Copy the task list for the current milestone from `PLAN.md` here when the milestone starts, and tick tasks as they merge.

### M0 Bootstrap

- [ ] M0.1 Confirm Docker works in the Claude Code cloud environment
- [x] M0.2 Monorepo layout, pnpm workspaces, uv, Makefile
- [ ] M0.3 API skeleton with local D1 and R2
- [ ] M0.4 Web skeleton with layout shell
- [ ] M0.5 Worker skeleton, Dockerfile, no-op job
- [ ] M0.6 `packages/spec` with first schema, type generation, `units.json`
- [ ] M0.7 `make dev`, `make test`, Commands section in `CLAUDE.md`
- [ ] M0.8 GitHub Actions fast tier, DCO check, nightly placeholder
- [ ] M0.9 Seeded test users and session login

## Maintainer to-do

Things only the maintainer can do.

- [ ] Create the public GitHub repository and upload these files
- [ ] Check domain, GitHub organisation name and trademark registers for "ClearFEA"
- [x] Review the proposed ADRs in `DECISIONS.md` and mark each accepted or changed (all eleven accepted 2026-10-14)
- [ ] Enable branch protection on `main` (require pull request and passing checks)
- [ ] Confirm Docker Desktop (or equivalent) runs on the verification laptop

## Verification status

| Tier | Last run | Result |
| --- | --- | --- |
| Fast (pull request) | never | |
| Nightly coarse | never | |
| Full | never | |

## Handoff notes

Written by the last session for the next one. Replace, do not append.

> Kickoff documents only. No code exists. Start with M0.1. ADR-001 to ADR-011 were accepted unchanged on 2026-10-14.
>
> Environment check (2026-10-14, Claude Code cloud): Docker CLI 29.8.2 and `dockerd` are installed but the daemon is not running (no socket); M0.1 must find out whether it can be started. pnpm 12.11.2, uv 0.11.32, wrangler 4.151.0, Node 22.22.0, Python 3.13 default with 3.12 present. CalculiX `ccx` 2.21 (Debian `calculix-ccx`) runs. Gmsh pip package 4.15.2 is installed but fails to load because `libGLU.so.1` is missing.
>
> M0.2 (2026-10-14): monorepo layout in place. `make install` and `make test` work; `make test` runs pnpm lint/typecheck/test across the workspace (no-ops until packages gain scripts) and ruff plus pytest in `worker/`. The TypeScript packages are empty `package.json` stubs with a README naming the task that fills them. `make dev`, `verify` and `e2e` are left for M0.7 and later. Python tooling choice is ADR-013 (proposed).
>
> Two points to watch from the ADR review: Gmsh may not report the STEP file's original length unit (check in the M1.1 spike), and browser-captured report figures (ADR-011) mean report generation needs the browser open.

## Parked ideas

Ideas that came up during work and are outside the current milestone. Do not build these without a decision.

- (none yet)

## Log

Newest first. One entry per session: date, what was done, what was learned.

### 2026-10-14

- M0.2: created the monorepo layout (`apps/web`, `apps/api`, `worker`, `packages/spec`, `verification`, `infra`), pnpm workspace, `uv` project for the worker, top-level `Makefile`.
- Maintainer accepted ADR-001 to ADR-011 unchanged.
- Checked tool availability in the cloud environment; see handoff notes.

### 2026-10-13

- Product interview completed; decisions recorded in `DECISIONS.md`.
- Architecture, plan, verification plan and working instructions written.
- Name search found no existing product called ClearFEA; nearest is ClearCalcs (structural calculations). Domain and trademark not checked.
