// SPDX-License-Identifier: AGPL-3.0-or-later
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

async function columns(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
    name: string;
  }>();
  return results.map((row) => row.name);
}

describe("migration 0001", () => {
  it("creates users and projects", async () => {
    expect(await columns("users")).toEqual(["id", "login", "name", "created_at"]);
    expect(await columns("projects")).toEqual([
      "id",
      "owner_id",
      "name",
      "default_unit_system",
      "visibility",
      "created_at",
      "updated_at",
    ]);
  });

  it("rejects a project whose owner does not exist", async () => {
    await env.DB.exec("PRAGMA foreign_keys = ON");
    const insert = env.DB.prepare(
      "INSERT INTO projects (id, owner_id, name) VALUES ('p1', 'nobody', 'Bracket')",
    );
    await expect(insert.run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it("keeps the R2 binding usable", async () => {
    await env.FILES.put("probe.txt", "hello");
    const object = await env.FILES.get("probe.txt");
    expect(await object?.text()).toBe("hello");
  });
});
