// SPDX-License-Identifier: AGPL-3.0-or-later
// The estimator's coefficients file and the laws it holds (ADR-049); fit.py writes the file and
// worker/tests/test_estimator.py checks that it is the fit of the benchmark.
import { describe, expect, it } from "vitest";
import {
  checkEstimatorTable,
  elementLimitProblem,
  estimateMesh,
  estimatorTable,
  fallbackSolver,
  maxElements,
  memoryFits,
  MAX_MODES,
  powerLaw,
  type RunKind,
  runSolverProblem,
  runSolvers,
  SOLVERS,
  STATIC_RUN,
  specRunKind,
} from "../src/estimator";

describe("the estimator table", () => {
  it("is refused when its fitted range is the wrong way round", () => {
    const models = estimatorTable.analyses.linear_static;
    const linear = { ...models, spooles: { ...models.spooles, fittedNodes: [9, 1] } };
    expect(() => checkEstimatorTable({ ...estimatorTable, analyses: { ...estimatorTable.analyses, linear_static: linear } })).toThrow(
      /spooles's fittedNodes/,
    );
  });

  it("is refused when it does not match its schema", () => {
    expect(() => checkEstimatorTable({ ...estimatorTable, memoryMargin: 0.5 })).toThrow(/does not match its schema/);
  });
});

describe("the estimate of a mesh", () => {
  it("evaluates constant + coefficient × nodes ^ exponent, rounded up", () => {
    expect(powerLaw({ constant: 1, coefficient: 2, exponent: 2, largestRatio: 1 }, 3)).toBe(19);
    const model = estimatorTable.analyses.linear_static.pastix;
    const estimate = estimateMesh(100_000, 2);
    expect(estimate.memoryBytes).toBe(Math.ceil(powerLaw(model.peakMemoryBytes, 100_000)));
    expect(estimate.seconds).toBe(Math.ceil(powerLaw(model.jobSecondsByOrder.order2, 100_000)));
    expect(estimate.extrapolated).toBe(false);
    expect(estimateMesh(model.fittedNodes[1] + 1, 2).extrapolated).toBe(true);
  });

  it("times a static run with its element order's law and sizes memory for both (M8.9)", () => {
    const model = estimatorTable.analyses.linear_static.iterative_scaling;
    const first = estimateMesh(37_725, 1, "iterative_scaling");
    const second = estimateMesh(37_725, 2, "iterative_scaling");
    expect(first.seconds).toBe(Math.ceil(powerLaw(model.jobSecondsByOrder.order1, 37_725)));
    expect(second.seconds).toBe(Math.ceil(powerLaw(model.jobSecondsByOrder.order2, 37_725)));
    // Per node a ten-node mesh takes longer to solve iteratively than a four-node one.
    expect(second.seconds).toBeGreaterThan(first.seconds);
    expect(first.memoryBytes).toBe(second.memoryBytes);
  });

  it("grows with the mesh", () => {
    const small = estimateMesh(10_000, 2);
    const large = estimateMesh(200_000, 2);
    expect(large.memoryBytes).toBeGreaterThan(small.memoryBytes);
    expect(large.seconds).toBeGreaterThan(small.seconds);
  });

  it("refuses a node count that is not a whole number, 0 or more", () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => estimateMesh(bad, 2)).toThrow(RangeError);
  });

  it("fits a machine only with the margin, in the usable share of its memory", () => {
    const usable = 1000 * estimatorTable.usableMemoryFraction;
    expect(memoryFits(usable / estimatorTable.memoryMargin, 1000)).toBe(true);
    expect(memoryFits(usable / estimatorTable.memoryMargin + 1, 1000)).toBe(false);
  });
});

describe("the solvers", () => {
  it("estimate with their own laws", () => {
    for (const solver of SOLVERS) {
      const model = estimatorTable.analyses.linear_static[solver];
      expect(estimateMesh(50_000, 2, solver).memoryBytes).toBe(Math.ceil(powerLaw(model.peakMemoryBytes, 50_000)));
    }
  });

  it("each take a limited number of elements per order on 16 GiB", () => {
    expect(estimatorTable.limitMemoryBytes).toBe(16 * 2 ** 30);
    for (const solver of SOLVERS) {
      // Per node both orders cost about the same, and a 4-node mesh has far fewer nodes; no
      // limit is above the largest mesh measured (461,993 elements for most solvers).
      expect(maxElements(solver, 1)).toBeGreaterThanOrEqual(maxElements(solver, 2));
    }
    expect(maxElements("pastix", 1)).toBeGreaterThan(maxElements("pastix", 2));
    // PaStiX needs more memory than SPOOLES, and the iterative solvers far less (ADR-063).
    expect(maxElements("pastix", 2)).toBeLessThan(maxElements("spooles", 2));
    expect(maxElements("spooles", 2)).toBeLessThan(maxElements("iterative_cholesky", 2));
  });
});

describe("the element limit", () => {
  it("lets a mesh at the limit run", () => {
    expect(elementLimitProblem("pastix", 2, maxElements("pastix", 2))).toBeNull();
  });

  it("refuses one element more, saying what to do", () => {
    const limit = maxElements("pastix", 2);
    const problem = elementLimitProblem("pastix", 2, limit + 1);
    expect(problem).toContain(`more than the ${limit.toLocaleString("en-US")} PaStiX can solve on a 16 GB machine`);
    expect(problem).toContain("use 4-node elements");
    expect(problem).toContain(`SPOOLES (up to ${maxElements("spooles", 2).toLocaleString("en-US")})`);
  });

  it("offers no solver when none takes the mesh", () => {
    const problem = elementLimitProblem("pastix", 1, 10_000_000);
    expect(problem).not.toContain("choose a solver");
  });
});

describe("a modal run (M6.3)", () => {
  const modal = (modes: number): RunKind => ({ analysis: "modal", modes });

  it("is solved with the solvers that have a modal model", () => {
    expect(runSolvers(modal(10))).toEqual(SOLVERS.filter((s) => estimatorTable.analyses.modal[s as "pastix" | "spooles"]));
    expect(runSolvers(modal(10))).not.toContain("iterative_cholesky");
    expect(runSolverProblem("iterative_scaling", modal(10))).toContain("cannot solve a modal analysis");
    expect(runSolverProblem("iterative_scaling", STATIC_RUN)).toBeNull();
  });

  it("costs more memory and time with more modes, and more than a static run", () => {
    for (const solver of runSolvers(modal(10))) {
      const few = estimateMesh(50_000, 2, solver, modal(1));
      const many = estimateMesh(50_000, 2, solver, modal(MAX_MODES));
      expect(many.memoryBytes).toBeGreaterThan(few.memoryBytes);
      expect(many.seconds).toBeGreaterThan(few.seconds);
      expect(few.seconds).toBeGreaterThanOrEqual(estimateMesh(50_000, 2, solver).seconds * 0.5);
    }
  });

  it("counts the most modes while the setup has no number yet", () => {
    expect(specRunKind({ analysis: "modal", modes: null })).toEqual(modal(MAX_MODES));
    expect(specRunKind({ analysis: "steady_thermal" })).toEqual({ analysis: "steady_thermal" });
  });

  it("has element limits of its own, for the most modes", () => {
    for (const solver of runSolvers(modal(10))) {
      const limit = maxElements(solver, 2, modal(10));
      expect(elementLimitProblem(solver, 2, limit, modal(10))).toBeNull();
      const problem = elementLimitProblem(solver, 2, limit + 1, modal(10));
      expect(problem).toContain(`in a modal analysis of up to ${MAX_MODES} modes`);
      expect(problem).not.toContain("Iterative");
    }
  });

  it("leaves a solver that cannot solve it to pre-run validation", () => {
    expect(elementLimitProblem("iterative_cholesky", 2, 10_000_000, modal(10))).toBeNull();
    expect(() => estimateMesh(1000, 2, "iterative_cholesky", modal(10))).toThrow("cannot solve a modal analysis");
  });
});

describe("the solver a crashed PaStiX run is solved again with (M12.2, ADR-108)", () => {
  it("is SPOOLES within SPOOLES's element limit", () => {
    expect(fallbackSolver("pastix", 2, maxElements("pastix", 2))).toBe("spooles");
    expect(fallbackSolver("pastix", 1, maxElements("spooles", 1))).toBe("spooles");
    expect(fallbackSolver("pastix", 1, maxElements("spooles", 1) + 1)).toBeNull();
    expect(fallbackSolver("pastix", 2, 1000, { analysis: "steady_thermal" })).toBe("spooles");
  });

  it("is none for the other solvers", () => {
    for (const solver of ["spooles", "iterative_cholesky", "iterative_scaling"] as const) {
      expect(fallbackSolver(solver, 2, 1000)).toBeNull();
    }
  });
});
