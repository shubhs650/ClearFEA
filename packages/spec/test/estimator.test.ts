// SPDX-License-Identifier: AGPL-3.0-or-later
// The estimator's coefficients file and the laws it holds (ADR-049); fit.py writes the file and
// worker/tests/test_estimator.py checks that it is the fit of the benchmark.
import { describe, expect, it } from "vitest";
import { checkEstimatorTable, estimateMesh, estimatorTable, memoryFits, powerLaw } from "../src/estimator";

describe("the estimator table", () => {
  it("is refused when its fitted range is the wrong way round", () => {
    const linear = { ...estimatorTable.analyses.linear_static, fittedNodes: [9, 1] };
    expect(() => checkEstimatorTable({ ...estimatorTable, analyses: { linear_static: linear } })).toThrow(/fittedNodes/);
  });

  it("is refused when it does not match its schema", () => {
    expect(() => checkEstimatorTable({ ...estimatorTable, memoryMargin: 0.5 })).toThrow(/does not match its schema/);
  });
});

describe("the estimate of a mesh", () => {
  it("evaluates constant + coefficient × nodes ^ exponent, rounded up", () => {
    expect(powerLaw({ constant: 1, coefficient: 2, exponent: 2, largestRatio: 1 }, 3)).toBe(19);
    const model = estimatorTable.analyses.linear_static;
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
