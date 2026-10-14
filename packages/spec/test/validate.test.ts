// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  JobTypeValues,
  unitsTable,
  validateClaimRequest,
  validateCompleteRequest,
  validateHealthResponse,
} from "../src";

describe("generated validators", () => {
  it("accept a valid health response and refuse a malformed one", () => {
    expect(validateHealthResponse({ status: "ok", database: "ok", storage: "ok" }).ok).toBe(true);
    const bad = validateHealthResponse({ status: "fine", database: "ok" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/storage/);
  });

  it("name the offending field", () => {
    const bad = validateClaimRequest({ workerId: "w1", jobTypes: ["noop", "bake"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toContain("/jobTypes/1");
  });

  it("tell the two completion shapes apart", () => {
    expect(validateCompleteRequest({ workerId: "w", status: "succeeded", result: {} }).ok).toBe(true);
    expect(
      validateCompleteRequest({
        workerId: "w",
        status: "failed",
        failureCategory: "user_fault",
        failureCause: "mesh_failed",
      }).ok,
    ).toBe(true);
    expect(validateCompleteRequest({ workerId: "w", status: "failed" }).ok).toBe(false);
    expect(validateCompleteRequest({ workerId: "", status: "succeeded" }).ok).toBe(false);
  });

  it("export enum values in schema order", () => {
    expect(JobTypeValues).toEqual(["noop", "import", "mesh", "solve", "report"]);
  });
});

describe("units table", () => {
  it("covers length, force and pressure with SI units", () => {
    expect(unitsTable.kinds.length?.si).toBe("m");
    expect(unitsTable.kinds.force?.si).toBe("N");
    expect(unitsTable.kinds.pressure?.si).toBe("Pa");
  });
});

describe("validator edge cases", () => {
  it("refuses undefined, as from an empty body, without throwing", () => {
    expect(validateHealthResponse(undefined)).toEqual({ ok: false, errors: ["/ is missing."] });
  });

  it("names a field that the schema does not allow", () => {
    const bad = validateClaimRequest({ workerId: "w1", jobTypes: [], extra: 1 });
    expect(bad).toEqual({ ok: false, errors: ["/extra is not an allowed field."] });
  });
});
