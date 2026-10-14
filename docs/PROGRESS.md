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
- [ ] M0.2 Monorepo layout, pnpm workspaces, uv, Makefile
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
- [ ] Review the proposed ADRs in `DECISIONS.md` and mark each accepted or changed
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

> Kickoff documents only. No code exists. Start with M0.1. All technology choices are proposals recorded as ADR-001 to ADR-011; if the maintainer has changed any, `DECISIONS.md` will say so.

## Parked ideas

Ideas that came up during work and are outside the current milestone. Do not build these without a decision.

- (none yet)

## Log

Newest first. One entry per session: date, what was done, what was learned.

### 2026-10-13

- Product interview completed; decisions recorded in `DECISIONS.md`.
- Architecture, plan, verification plan and working instructions written.
- Name search found no existing product called ClearFEA; nearest is ClearCalcs (structural calculations). Domain and trademark not checked.
