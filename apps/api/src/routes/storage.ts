// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's storage (M8.6, ADR-085): what is kept, by kind, against the free
// allowance, and the runs holding raw solver output with when it goes. Shapes:
// packages/spec/schemas/storage.schema.json. Pins are set under /api/runs/:id/pin.

import type { StorageResponse } from "@clearfea/spec";
import { Hono } from "hono";
import { rawOutputKeptUntil } from "../db/runs";
import { storageSettings } from "../db/settings";
import { measureStorage, runsWithRawOutput } from "../db/storage";
import { requireUser, type SessionEnv } from "../session";

export const storage = new Hono<SessionEnv>();

storage.use("*", requireUser);

storage.get("/", async (c) => {
  const [settings, use, runs] = await Promise.all([
    storageSettings(c.env.DB),
    measureStorage(c.env.FILES, c.var.userId),
    runsWithRawOutput(c.env.DB, c.var.userId),
  ]);
  return c.json({
    storage: {
      usedBytes: use.usedBytes,
      freeBytes: settings.freeBytes,
      ratePerGibDay: settings.ratePerGibDay,
      retentionDays: settings.retentionDays,
      parts: use.parts,
      runs: runs.map((run) => ({
        id: run.id,
        simulationId: run.simulationId,
        simulationName: run.simulationName,
        startedAt: run.startedAt,
        bytes: use.rawBytesByRun.get(run.id) ?? 0,
        pinned: run.pinned,
        keptUntil: rawOutputKeptUntil({ ...run, rawRemovedAt: null }, settings.retentionDays),
      })),
    },
  } satisfies StorageResponse);
});
