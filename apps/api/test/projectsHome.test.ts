// SPDX-License-Identifier: AGPL-3.0-or-later
// Projects in folders (M14.1, ADR-114): migration 0029 moves each user's work into "My first
// project", the database refuses work placed in another user's folder or project, and the
// data-access layer answers each user with their own folders and projects only.
import type { SimulationSpec } from "@clearfea/spec";
import fixture from "@clearfea/spec/fixtures/simulation-v1.json";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGeometry } from "../src/db/geometries";
import {
  createFolder,
  createProject,
  FIRST_PROJECT_NAME,
  getFolder,
  getProject,
  listFolders,
  listProjects,
  markProjectOpened,
  userProject,
} from "../src/db/projects";
import { createSimulation } from "../src/db/simulations";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const spec = (geometryId: string): SimulationSpec => ({
  ...(JSON.parse(JSON.stringify(fixture)) as SimulationSpec),
  geometryId,
});

describe("migration 0029", () => {
  const db = () => env.MIGRATION_DB;
  const rows = async <T>(sql: string): Promise<T[]> => (await db().prepare(sql).all<T>()).results;

  beforeAll(async () => {
    const index = env.TEST_MIGRATIONS.findIndex((m) => m.name.startsWith("0029_"));
    expect(index).toBeGreaterThan(0);
    await applyD1Migrations(db(), env.TEST_MIGRATIONS.slice(0, index));
    // As the live database stood: alice has the one project of ADR-038 and work outside it,
    // bob has work but never opened the unit system list, carol has nothing at all.
    const geometry = (id: string, owner: string) =>
      db()
        .prepare("INSERT INTO geometries (id, owner_id, name, size_bytes, status) VALUES (?, ?, 'part.step', 1, 'ready')")
        .bind(id, owner);
    const simulation = (id: string, owner: string, geometryId: string) =>
      db()
        .prepare(
          `INSERT INTO simulations (id, owner_id, geometry_id, name, analysis_type, spec_version, spec)
           VALUES (?, ?, ?, 'Bracket', 'linear_static', 1, '{}')`,
        )
        .bind(id, owner, geometryId);
    await db().batch([
      db().prepare("INSERT INTO users (id, login, name) VALUES ('alice', 'alice', 'Alice'), ('bob', 'bob', 'Bob'), ('carol', 'carol', 'Carol')"),
      db().prepare("INSERT INTO projects (id, owner_id, name, default_unit_system) VALUES ('pa', 'alice', 'My project', 'us-in')"),
      geometry("ga1", "alice"),
      geometry("ga2", "alice"),
      simulation("sa1", "alice", "ga1"),
      geometry("gb1", "bob"),
      simulation("sb1", "bob", "gb1"),
    ]);
    await applyD1Migrations(db(), env.TEST_MIGRATIONS);
  });

  it("renames the one project a user had, keeping its unit system", async () => {
    expect(await rows("SELECT id, name, default_unit_system FROM projects WHERE owner_id = 'alice'")).toEqual([
      { id: "pa", name: FIRST_PROJECT_NAME, default_unit_system: "us-in" },
    ]);
  });

  it("makes a first project for a user with work and none, and none for a user without work", async () => {
    const bobs = await rows<{ id: string; name: string }>("SELECT id, name FROM projects WHERE owner_id = 'bob'");
    expect(bobs).toHaveLength(1);
    expect(bobs[0]?.name).toBe(FIRST_PROJECT_NAME);
    expect(bobs[0]?.id).toMatch(UUID);
    expect(await rows("SELECT id FROM projects WHERE owner_id = 'carol'")).toEqual([]);
  });

  it("puts every geometry and simulation into its owner's project", async () => {
    const bobs = (await rows<{ id: string }>("SELECT id FROM projects WHERE owner_id = 'bob'"))[0]?.id;
    expect(await rows("SELECT id, project_id FROM geometries ORDER BY id")).toEqual([
      { id: "ga1", project_id: "pa" },
      { id: "ga2", project_id: "pa" },
      { id: "gb1", project_id: bobs },
    ]);
    expect(await rows("SELECT id, project_id FROM simulations ORDER BY id")).toEqual([
      { id: "sa1", project_id: "pa" },
      { id: "sb1", project_id: bobs },
    ]);
  });

  it("leaves every project at the top of the home, out of the trash, never opened, without a thumbnail", async () => {
    expect(
      await rows("SELECT DISTINCT folder_id, deleted_at, last_opened_at, thumbnail_at FROM projects"),
    ).toEqual([{ folder_id: null, deleted_at: null, last_opened_at: null, thumbnail_at: null }]);
  });
});

describe("the database", () => {
  let alicesProject = "";
  let bobsProject = "";
  let bobsFolder = "";
  let alicesGeometry = "";

  beforeAll(async () => {
    await env.DB.batch(env.TEST_SEED.flatMap((file) => file.queries).map((sql) => env.DB.prepare(sql)));
    alicesProject = (await userProject(env.DB, ALICE)).id;
    bobsProject = (await userProject(env.DB, BOB)).id;
    bobsFolder = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO folders (id, owner_id, name) VALUES (?, ?, 'Pumps')").bind(bobsFolder, BOB).run();
    alicesGeometry = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO geometries (id, owner_id, project_id, name, size_bytes, status) VALUES (?, ?, ?, 'a.step', 1, 'ready')",
    )
      .bind(alicesGeometry, ALICE, alicesProject)
      .run();
  });

  const refused = (sql: string, ...values: unknown[]) =>
    expect(env.DB.prepare(sql).bind(...values).run()).rejects.toThrow(/must/);

  it("refuses a geometry outside a project, or in another user's project", async () => {
    const insert = "INSERT INTO geometries (id, owner_id, project_id, name, size_bytes) VALUES (?, ?, ?, 'x.step', 1)";
    await refused(insert, crypto.randomUUID(), ALICE, null);
    await refused(insert, crypto.randomUUID(), ALICE, bobsProject);
    await refused("UPDATE geometries SET project_id = ? WHERE id = ?", bobsProject, alicesGeometry);
    await refused("UPDATE geometries SET project_id = NULL WHERE id = ?", alicesGeometry);
  });

  it("refuses a simulation outside its geometry's project", async () => {
    const insert = `INSERT INTO simulations (id, owner_id, geometry_id, project_id, name, analysis_type, spec_version, spec)
                    VALUES (?, ?, ?, ?, 'S', 'linear_static', 1, '{}')`;
    await refused(insert, crypto.randomUUID(), ALICE, alicesGeometry, null);
    await refused(insert, crypto.randomUUID(), ALICE, alicesGeometry, bobsProject);
    const other = (await createProject(env.DB, ALICE, { id: crypto.randomUUID(), name: "Other", folderId: null }))?.id;
    await refused(insert, crypto.randomUUID(), ALICE, alicesGeometry, other);
    // Bob naming alice's geometry with his own project is refused as well.
    await refused(insert, crypto.randomUUID(), BOB, alicesGeometry, bobsProject);
  });

  it("refuses a project or folder in another user's folder", async () => {
    await refused("INSERT INTO projects (id, owner_id, name, folder_id) VALUES (?, ?, 'P', ?)", crypto.randomUUID(), ALICE, bobsFolder);
    await refused("UPDATE projects SET folder_id = ? WHERE id = ?", bobsFolder, alicesProject);
    await refused("INSERT INTO folders (id, owner_id, name, parent_id) VALUES (?, ?, 'F', ?)", crypto.randomUUID(), ALICE, bobsFolder);
    const alicesFolder = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO folders (id, owner_id, name) VALUES (?, ?, 'Mine')").bind(alicesFolder, ALICE).run();
    await refused("UPDATE folders SET parent_id = ? WHERE id = ?", bobsFolder, alicesFolder);
  });
});

describe("the data-access layer", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM simulations"),
      env.DB.prepare("DELETE FROM geometries"),
      env.DB.prepare("DELETE FROM jobs"),
      env.DB.prepare("DELETE FROM projects"),
      env.DB.prepare("DELETE FROM folders WHERE parent_id IS NOT NULL"),
      env.DB.prepare("DELETE FROM folders"),
    ]);
    await env.DB.batch(env.TEST_SEED.flatMap((file) => file.queries).map((sql) => env.DB.prepare(sql)));
  });

  it("puts an upload into the given project and a simulation into its geometry's", async () => {
    const project = await userProject(env.DB, ALICE);
    expect(project.name).toBe(FIRST_PROJECT_NAME);
    const id = crypto.randomUUID();
    const { geometry } = await createGeometry(env.DB, ALICE, { id, projectId: project.id, name: "a.step", sizeBytes: 1 });
    expect(geometry.projectId).toBe(project.id);
    await env.DB.prepare("UPDATE geometries SET status = 'ready' WHERE id = ?").bind(id).run();
    const simulation = await createSimulation(env.DB, ALICE, { id: crypto.randomUUID(), name: "S", spec: spec(id) });
    expect(simulation?.projectId).toBe(project.id);
  });

  it("refuses an upload into another user's project", async () => {
    const bobs = await userProject(env.DB, BOB);
    const upload = createGeometry(env.DB, ALICE, { id: crypto.randomUUID(), projectId: bobs.id, name: "a.step", sizeBytes: 1 });
    await expect(upload).rejects.toThrow(/must/);
  });

  it("makes folders and projects only inside the user's own folders outside the trash", async () => {
    const pumps = await createFolder(env.DB, ALICE, { id: crypto.randomUUID(), name: "Pumps", parentId: null });
    expect(pumps).toMatchObject({ name: "Pumps", parentId: null, deletedAt: null });
    const inner = await createFolder(env.DB, ALICE, { id: crypto.randomUUID(), name: "Impellers", parentId: pumps?.id ?? "" });
    expect(inner?.parentId).toBe(pumps?.id);
    const project = await createProject(env.DB, ALICE, { id: crypto.randomUUID(), name: "Housing", folderId: inner?.id ?? "" });
    expect(project).toMatchObject({ name: "Housing", folderId: inner?.id, deletedAt: null, lastOpenedAt: null, thumbnailAt: null });

    // Bob's attempts in alice's folders make nothing, and say so the way an unknown folder does.
    for (const parentId of [pumps?.id ?? "", crypto.randomUUID()]) {
      expect(await createFolder(env.DB, BOB, { id: crypto.randomUUID(), name: "X", parentId })).toBeNull();
      expect(await createProject(env.DB, BOB, { id: crypto.randomUUID(), name: "X", folderId: parentId })).toBeNull();
    }
    await env.DB.prepare("UPDATE folders SET deleted_at = 'now' WHERE id = ?").bind(inner?.id).run();
    expect(await createProject(env.DB, ALICE, { id: crypto.randomUUID(), name: "X", folderId: inner?.id ?? "" })).toBeNull();
    expect(await createFolder(env.DB, ALICE, { id: crypto.randomUUID(), name: "X", parentId: inner?.id ?? "" })).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM folders").first<{ n: number }>())?.n).toBe(2);
  });

  it("answers each user with their own folders and projects, leaving the trash out of the lists", async () => {
    const folder = await createFolder(env.DB, ALICE, { id: crypto.randomUUID(), name: "Pumps", parentId: null });
    const kept = await createProject(env.DB, ALICE, { id: crypto.randomUUID(), name: "Kept", folderId: null });
    const binned = await createProject(env.DB, ALICE, { id: crypto.randomUUID(), name: "Binned", folderId: null });
    await env.DB.prepare("UPDATE projects SET deleted_at = 'now' WHERE id = ?").bind(binned?.id).run();

    expect((await listProjects(env.DB, ALICE)).map((p) => p.name)).toEqual(["Kept"]);
    expect((await listFolders(env.DB, ALICE)).map((f) => f.name)).toEqual(["Pumps"]);
    expect(await listProjects(env.DB, BOB)).toEqual([]);
    expect(await listFolders(env.DB, BOB)).toEqual([]);

    expect((await getProject(env.DB, ALICE, binned?.id ?? ""))?.deletedAt).toBe("now");
    expect(await getProject(env.DB, BOB, kept?.id ?? "")).toBeNull();
    expect(await getFolder(env.DB, BOB, folder?.id ?? "")).toBeNull();

    expect(await markProjectOpened(env.DB, BOB, kept?.id ?? "")).toBe(false);
    expect((await getProject(env.DB, ALICE, kept?.id ?? ""))?.lastOpenedAt).toBeNull();
    expect(await markProjectOpened(env.DB, ALICE, kept?.id ?? "")).toBe(true);
    expect((await getProject(env.DB, ALICE, kept?.id ?? ""))?.lastOpenedAt).not.toBeNull();
  });

  it("makes a new first project when the user's only one is in the trash", async () => {
    const first = await userProject(env.DB, ALICE);
    await env.DB.prepare("UPDATE projects SET deleted_at = 'now' WHERE id = ?").bind(first.id).run();
    const again = await userProject(env.DB, ALICE);
    expect(again.id).not.toBe(first.id);
    expect(again.name).toBe(FIRST_PROJECT_NAME);
    expect(await userProject(env.DB, ALICE)).toEqual(again);
  });
});
