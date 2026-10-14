# apps/web

React, Vite and TypeScript frontend. M0.4 adds the layout shell: simulation tree on the left, viewer in the centre, settings panel on the right and a status bar along the bottom that reports the API's health. The three.js viewer arrives with the geometry work in M1.

```
pnpm --filter @clearfea/api dev    # API on http://localhost:8787
pnpm --filter @clearfea/web dev    # web app on http://localhost:5173
```

The Vite dev server forwards `/api` to port 8787, so the browser talks to one origin and the API needs no CORS handling. If the API is not running, the status bar says so and how to start it.

Tests run in Vitest with jsdom: `pnpm --filter @clearfea/web test`.
