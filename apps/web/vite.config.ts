// SPDX-License-Identifier: AGPL-3.0-or-later
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The API runs on `wrangler dev` at port 8787. The dev server forwards /api to it,
// so the browser sees one origin and the API needs no CORS handling.
const apiOrigin = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": apiOrigin },
  },
  preview: {
    port: 4173,
    proxy: { "/api": apiOrigin },
  },
  test: {
    environment: "jsdom",
  },
});
