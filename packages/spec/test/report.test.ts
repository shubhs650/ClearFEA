// SPDX-License-Identifier: AGPL-3.0-or-later
// The report's standing notes (M4.5, ADR-062) and which runs carry them.
import { describe, expect, it } from "vitest";
import { emptySimulationSpec } from "../src/simulation";
import { checkReportNotes, hasTiedBonds, reportNotes, runReportNotes } from "../src/report";

const empty = () => emptySimulationSpec("g1", { bodies: [{ tag: 1 }, { tag: 2 }], faces: [] });
const bonded = (status: "detected" | "accepted" | "removed") => ({
  ...empty(),
  bonds: [{ faces: [3, 9] as [number, number], status }],
});

describe("the report notes file", () => {
  it("has the tied-interface note with its measured figures and no verdict", () => {
    const note = reportNotes.notes.find((n) => n.id === "tiedInterfaces");
    expect(note?.appliesWhen).toBe("tiedBonds");
    expect(note?.text).toMatch(/13% below to 12% above/);
    for (const n of reportNotes.notes) {
      expect(`${n.title} ${n.text}`).not.toMatch(/\b(pass|fail|passes|fails|compliant|compliance)\b/i);
    }
  });

  it("is refused when it does not match its schema", () => {
    expect(() => checkReportNotes({ ...reportNotes, version: 0 })).toThrow(/does not match its schema/);
    const [first] = reportNotes.notes;
    expect(() => checkReportNotes({ ...reportNotes, notes: [{ ...first, appliesWhen: "always" }] })).toThrow(
      /does not match its schema/,
    );
  });

  it("is refused when a note is listed twice", () => {
    expect(() => checkReportNotes({ ...reportNotes, notes: [...reportNotes.notes, ...reportNotes.notes] })).toThrow(
      /listed twice/,
    );
  });
});

describe("the notes a run carries", () => {
  it("include the tied-interface note when a bond is tied", () => {
    expect(hasTiedBonds(bonded("detected"))).toBe(true);
    expect(hasTiedBonds(bonded("accepted"))).toBe(true);
    expect(runReportNotes(bonded("accepted")).map((n) => n.id)).toEqual(["tiedInterfaces"]);
  });

  it("leave it out when every bond is removed or the run froze no bond list", () => {
    expect(runReportNotes(bonded("removed"))).toEqual([]);
    expect(runReportNotes(empty())).toEqual([]);
    expect(runReportNotes({ ...empty(), bonds: [] })).toEqual([]);
  });
});
