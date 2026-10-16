// SPDX-License-Identifier: AGPL-3.0-or-later
// The estimator's coefficients file and the laws it holds (ADR-049); fit.py writes the file and
// worker/tests/test_estimator.py checks that it is the fit of the benchmark.
import { describe, expect, it } from "vitest";
import {
  checkEstimatorTable,
  elementLimitProblem,
  estimateMesh,
  estimatorTable,
  maxElements,
  memoryFits,
  powerLaw,
  SOLVERS,
} from "../src/estimator";

describe("the estimator table", () => {
  it("is refused when its fitted range is the wrong way round", () => {
    const models = estimatorTable.analyses.linear_static;
    const linear = { ...models, spooles: { ...models.spooles, fittedNodes: [9, 1] } };
    expect(() => checkEstimatorTable({ ...estimatorTable, analyses: { linear_static: linear } })).toThrow(
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
    const estimate = estimateMesh(100_000);
    expect(estimate.memoryBytes).toBe(Math.ceil(powerLaw(model.peakMemoryBytes, 100_000)));
    expect(estimate.seconds).toBe(Math.ceil(powerLaw(model.jobSeconds, 100_000)));
    expect(estimate.extrapolated).toBe(false);
    expect(estimateMesh(model.fittedNodes[1] + 1).extrapolated).toBe(true);
  });

  it("grows with the mesh", () => {
    const small = estimateMesh(10_000);
    const large = estimateMesh(200_000);
    expect(large.memoryBytes).toBeGreaterThan(small.memoryBytes);
    expect(large.seconds).toBeGreaterThan(small.seconds);
  });

  it("refuses a node count that is not a whole number, 0 or more", () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => estimateMesh(bad)).toThrow(RangeError);
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
      expect(estimateMesh(50_000, solver).memoryBytes).toBe(Math.ceil(powerLaw(model.peakMemoryBytes, 50_000)));
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
    // PaStiX needs more memory than SPOOLES, and the iterative solvers far less (ADR-058).
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
