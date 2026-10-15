// SPDX-License-Identifier: AGPL-3.0-or-later
// The material library and the signed-in user's own materials (M2.9, ADR-046).
// Shapes: packages/spec/schemas/simulation.schema.json.

import {
  type MaterialResponse,
  type MaterialsResponse,
  materialLibrary,
  materialProblems,
  validateSaveMaterialRequest,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { deleteMaterial, listMaterials, saveMaterial } from "../db/materials";
import { requireUser, type SessionEnv } from "../session";

export const materials = new Hono<SessionEnv>();

materials.use("*", requireUser);

materials.get("/", async (c) => {
  const custom = await listMaterials(c.env.DB, c.var.userId);
  return c.json({ library: materialLibrary.materials, custom } satisfies MaterialsResponse);
});

materials.post("/", async (c) => {
  const body = await readBody(c.req.raw, validateSaveMaterialRequest, "SaveMaterialRequest", "simulation.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { material } = body.value;
  const missing = [
    ...(material.youngsModulus === null ? ["Young's modulus"] : []),
    ...(material.poissonsRatio === null ? ["Poisson's ratio"] : []),
  ];
  if (missing.length > 0) {
    return c.json({ error: `Enter ${missing.join(" and ")} of material "${material.name}" before saving it.` }, 400);
  }
  const problems = materialProblems(material);
  if (problems.length > 0) return c.json({ error: problems.join(" ") }, 400);
  const saved = await saveMaterial(c.env.DB, c.var.userId, material);
  if (saved === null) {
    return c.json(
      { error: `You already have a material named "${material.name}". Rename this one, or delete the saved one first.` },
      409,
    );
  }
  return c.json({ material: saved } satisfies MaterialResponse, 201);
});

materials.delete("/:id", async (c) => {
  if (!(await deleteMaterial(c.env.DB, c.var.userId, c.req.param("id")))) {
    return c.json({ error: "There is no material with that id among your materials." }, 404);
  }
  return c.body(null, 204);
});
