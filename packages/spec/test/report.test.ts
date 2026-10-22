// SPDX-License-Identifier: AGPL-3.0-or-later
// The report's standing statements (M7.5, ADR-073) and notes (M4.5, ADR-062), and which runs carry
// the notes.
import { describe, expect, it } from "vitest";
import { ITERATIVE_ACCURACY_NOTE } from "../src/estimator";
import type { RunSoftware } from "../src/generated/simulation";
import { emptySimulationSpec } from "../src/simulation";
import {
  checkReportNotes,
  frozenRunSolver,
  hasTiedBonds,
  NOT_RECORDED,
  reportNotes,
  runReportNotes,
  runReportStatements,
} from "../src/report";

const VERDICT = /\b(pass|fail|passed|failed|passes|fails|compliant|compliance|acceptable|unacceptable|safe|unsafe|ok)\b/i;

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
    for (const n of [...reportNotes.statements, ...reportNotes.notes]) {
      expect(`${n.title} ${n.text}`).not.toMatch(VERDICT);
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
    const [first] = reportNotes.notes;
    const clash = { ...reportNotes.statements[0], id: first?.id };
    expect(() => checkReportNotes({ ...reportNotes, statements: [clash] })).toThrow(/listed twice/);
  });

  it("has the standing statements every report prints, in order", () => {
    expect(reportNotes.statements.map((s) => s.id)).toEqual(["toolPositioning", "softwareVersions", "verificationLink"]);
    const text = (id: string) => reportNotes.statements.find((s) => s.id === id)?.text ?? "";
    expect(text("toolPositioning")).toMatch(/general-purpose finite element analysis tool/);
    expect(text("toolPositioning")).toMatch(/does not compare them with any design code/);
    for (const field of ["{clearfea}", "{deckFormat}", "{calculix}", "{gmsh}", "{occt}", "{solver}"]) {
      expect(text("softwareVersions")).toContain(field);
    }
    expect(text("verificationLink")).toContain("{verificationUrl}");
    // The published results page (M9.7, ADR-092), which ADR-073 item 5 left to M9.
    expect(reportNotes.verificationUrl).toMatch(/^https:\/\/.*VERIFICATION_RESULTS\.md$/);
  });

  it("is refused when a statement names something no run fills, or a note names anything", () => {
    const [statement] = reportNotes.statements;
    expect(() =>
      checkReportNotes({ ...reportNotes, statements: [{ ...statement, text: "Made by {company}." }] }),
    ).toThrow(/names \{company\}, which no run fills/);
    const [note] = reportNotes.notes;
    expect(() => checkReportNotes({ ...reportNotes, notes: [{ ...note, text: "Solved by {solver}." }] })).toThrow(
      /only statements are filled/,
    );
    expect(() => checkReportNotes({ ...reportNotes, verificationUrl: "http://example.org" })).toThrow(
      /does not match its schema/,
    );
  });
});

describe("the statements a run's report prints", () => {
  const software: RunSoftware = {
    clearfea: "0.0.0+d9d394b",
    deckFormat: 7,
    calculix: "2.21",
    gmsh: "4.13.1",
    occt: "7.8.1",
  };
  const byId = (statements: { id: string; text: string }[], id: string) =>
    statements.find((s) => s.id === id)?.text ?? "";

  it("fill the run's versions, solver and the verification link", () => {
    const statements = runReportStatements({ spec: { ...empty(), solver: "pastix" }, software });
    expect(statements.map((s) => s.id)).toEqual(reportNotes.statements.map((s) => s.id));
    const versions = byId(statements, "softwareVersions");
    expect(versions).toContain("ClearFEA 0.0.0+d9d394b");
    expect(versions).toContain("Gmsh 4.13.1 with OpenCASCADE 7.8.1");
    expect(versions).toContain("deck format 7");
    expect(versions).toContain("CalculiX 2.21 with the PaStiX equation solver");
    expect(versions).not.toContain(ITERATIVE_ACCURACY_NOTE);
    expect(byId(statements, "verificationLink")).toContain(reportNotes.verificationUrl);
    for (const s of statements) {
      expect(s.text).not.toMatch(/[{}]/);
      expect(`${s.title} ${s.text}`).not.toMatch(VERDICT);
    }
  });

  it("say which versions a run did not record", () => {
    const none: RunSoftware = { clearfea: null, deckFormat: null, calculix: null, gmsh: null, occt: null };
    const versions = byId(runReportStatements({ spec: empty(), software: none }), "softwareVersions");
    expect(versions).toContain(`ClearFEA ${NOT_RECORDED}`);
    expect(versions).toContain(`deck format ${NOT_RECORDED}`);
    expect(versions).toContain(`CalculiX ${NOT_RECORDED}`);
  });

  it("name SPOOLES for runs frozen before the solver was recorded", () => {
    const { solver: _, ...older } = empty();
    expect(frozenRunSolver(older)).toBe("spooles");
    expect(byId(runReportStatements({ spec: older, software }), "softwareVersions")).toContain(
      "with the SPOOLES equation solver",
    );
  });

  it("name the solver that solved the run, which its result records since M12.2", () => {
    const run = { spec: { ...empty(), solver: "pastix" as const }, software, result: { solver: "spooles" as const } };
    expect(frozenRunSolver(run.spec, run.result)).toBe("spooles");
    expect(byId(runReportStatements(run), "softwareVersions")).toContain("with the SPOOLES equation solver");
  });

  it("carry the accuracy note when the run used an iterative solver", () => {
    const versions = byId(
      runReportStatements({ spec: { ...empty(), solver: "iterative_scaling" }, software }),
      "softwareVersions",
    );
    expect(versions).toContain("with the Iterative scaling equation solver.");
    expect(versions.endsWith(ITERATIVE_ACCURACY_NOTE)).toBe(true);
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
