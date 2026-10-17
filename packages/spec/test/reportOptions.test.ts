// SPDX-License-Identifier: AGPL-3.0-or-later
// Report options (M7.1, ADR-073): defaults, printing order and the schema's limits.
import { describe, expect, it } from "vitest";
import { ReportSectionValues, validateReportBranding, validateReportOptions } from "../src/generated/report";
import { defaultReportOptions, orderedReportOptions, reportSectionLabels } from "../src/reportOptions";

describe("report options", () => {
  it("start with every section, no views and the simulation's name as the title", () => {
    const options = defaultReportOptions("Bracket");
    expect(options.sections).toEqual([...ReportSectionValues]);
    expect(options.views).toEqual([]);
    expect(options.titleBlock.title).toBe("Bracket");
    expect(validateReportOptions(options).ok).toBe(true);
  });

  it("keep a long simulation name within the title's limit", () => {
    expect(validateReportOptions(defaultReportOptions("x".repeat(300))).ok).toBe(true);
  });

  it("put sections in printing order and keep the views' order", () => {
    const options = { ...defaultReportOptions("A"), sections: ["warnings", "project", "mesh"] as const, views: ["b", "a"] };
    const ordered = orderedReportOptions({ ...options, sections: [...options.sections] });
    expect(ordered.sections).toEqual(["project", "mesh", "warnings"]);
    expect(ordered.views).toEqual(["b", "a"]);
  });

  it("name every section, without verdict wording", () => {
    expect(Object.keys(reportSectionLabels)).toEqual([...ReportSectionValues]);
    for (const label of Object.values(reportSectionLabels)) {
      expect(label).not.toMatch(/\b(pass|fail|compliant|compliance)\b/i);
    }
  });

  it("refuse an unknown section, a repeated view and an over-long title", () => {
    const options = defaultReportOptions("A");
    expect(validateReportOptions({ ...options, sections: ["verdict"] }).ok).toBe(false);
    expect(validateReportOptions({ ...options, views: ["v", "v"] }).ok).toBe(false);
    expect(validateReportOptions({ ...options, titleBlock: { ...options.titleBlock, title: "x".repeat(201) } }).ok).toBe(
      false,
    );
  });

  it("accept branding with or without a logo, and only PNG or JPEG logos", () => {
    const logo = { contentType: "image/png", sizeBytes: 10, width: 4, height: 2, updatedAt: "t" };
    expect(validateReportBranding({ companyName: "Acme", logo: null }).ok).toBe(true);
    expect(validateReportBranding({ companyName: "Acme", logo }).ok).toBe(true);
    expect(validateReportBranding({ companyName: "Acme", logo: { ...logo, contentType: "image/svg+xml" } }).ok).toBe(false);
  });
});
