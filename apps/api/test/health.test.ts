// SPDX-License-Identifier: AGPL-3.0-or-later
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("reports database and storage as reachable", async () => {
    const response = await exports.default.fetch("http://localhost/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: "ok",
      storage: "ok",
    });
  });

  it("tells the developer to migrate when tables are missing", async () => {
    await env.DB.exec("DROP TABLE projects");
    const response = await exports.default.fetch("http://localhost/api/health");
    expect(response.status).toBe(503);
    const body = await response.json<{ status: string; database: string }>();
    expect(body.status).toBe("degraded");
    expect(body.database).toContain("db:migrate");
  });
});
