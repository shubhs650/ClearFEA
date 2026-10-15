# apps/web

React, Vite and TypeScript frontend. M0.4 adds the layout shell: simulation tree on the left, viewer in the centre, settings panel on the right and a status bar along the bottom that reports the API's health. The three.js viewer arrives with the geometry work in M1.

```
pnpm --filter @clearfea/api dev    # API on http://localhost:8787
pnpm --filter @clearfea/web dev    # web app on http://localhost:5173
```

The Vite dev server forwards `/api` to port 8787, so the browser talks to one origin and the API needs no CORS handling. If the API is not running, the status bar says so and how to start it.

The app shows a sign-in form until a user is signed in (test users: `apps/api/seed/test-users.sql`). The settings pane has a "Worker check" that queues a no-op job and polls its status every two seconds while it is active.

Tests run in Vitest with jsdom: `pnpm --filter @clearfea/web test`.

## Browser end-to-end tests

`make e2e` runs the Playwright tests in `e2e/` (`*.e2e.ts`, listed in `docs/VERIFICATION.md`) against a fresh stack of their own: an API on :8789 with an empty local database, a worker container and this dev server on :5174 (`infra/e2e.sh`, ADR-036). It writes the test model with Gmsh first (`e2e/block.py`), so the host needs the worker's Python environment and Gmsh's system libraries, as for `make verify`. The report, failure traces and a screenshot of the final contour go to the folder it names (or `E2E_OUT`); extra arguments go to Playwright, for example `infra/e2e.sh --headed`.

Playwright is pinned to 1.56.1, whose Chromium is build 1194. Install that browser once with `pnpm --filter @clearfea/web exec playwright install chromium` (the Claude Code cloud environment already has it in `/opt/pw-browsers`). WebGL runs on SwiftShader, so no GPU is needed.

Faces are picked the way a user picks them: the test moves the pointer over the viewer until the hover line names the wanted face, then clicks. The face is chosen by its bounding box from the geometry's `topology.json`, so the test does not depend on face numbering.
