// SPDX-License-Identifier: AGPL-3.0-or-later
import { type EstimatorTable, estimatorTable } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import { estimateRun, type MachineSize, runSize } from "../src/billing/estimate";

const GiB = 2 ** 30;

/** Round numbers, so the expected values can be worked out by hand. */
const TABLE: EstimatorTable = {
  ...estimatorTable,
  version: 7,
  analyses: {
    linear_static: {
      solver: "test",
      // 1,000 bytes per node; 10 s plus 1 ms per node.
      peakMemoryBytes: { constant: 0, coefficient: 1000, exponent: 1, largestRatio: 1 },
      jobSeconds: { constant: 10, coefficient: 0.001, exponent: 1, largestRatio: 1 },
      fittedNodes: [1000, 1_000_000],
    },
  },
  memoryMargin: 1.25,
  usableMemoryFraction: 0.8,
};

const SIZES: MachineSize[] = [
  { name: "big", cores: 8, memoryBytes: 10 * GiB, ratePerHour: 3_600_000 },
  { name: "tiny", cores: 1, memoryBytes: 1 * GiB, ratePerHour: 360_000 },
];

describe("the run estimate", () => {
  it("prices the fitted time on every size, cheapest first, and recommends the cheapest that fits", () => {
    // 500,000 nodes: 0.5 GB peak, needing 0.625 GB of the 0.8 GiB usable on tiny; 510 s.
    const estimate = estimateRun(500_000, SIZES, TABLE);
    expect(estimate).toEqual({
      estimator: 7,
      nodes: 500_000,
      memoryBytes: 500_000_000,
      seconds: 510,
      extrapolated: false,
      sizes: [
        { size: "tiny", cores: 1, memoryBytes: GiB, ratePerHour: 360_000, cost: 51_000, fits: true },
        { size: "big", cores: 8, memoryBytes: 10 * GiB, ratePerHour: 3_600_000, cost: 510_000, fits: true },
      ],
      recommended: "tiny",
    });
  });

  it("is conservative on memory: the margin decides when a size stops fitting", () => {
    // tiny holds 0.8 GiB = 858,993,459 bytes for the solver; with the 1.25 margin a peak of up to
    // 687,194,767 bytes fits.
    expect(estimateRun(687_194, SIZES, TABLE).recommended).toBe("tiny");
    expect(estimateRun(687_195, SIZES, TABLE).recommended).toBe("big");
  });

  it("recommends nothing when no size fits, and says when the mesh is past the fitted range", () => {
    const estimate = estimateRun(7_000_000, SIZES, TABLE);
    expect(estimate.recommended).toBeNull();
    expect(estimate.extrapolated).toBe(true);
    expect(estimate.sizes.every((s) => !s.fits)).toBe(true);
  });

  it("rounds memory and time up", () => {
    const estimate = estimateRun(1001, SIZES, TABLE);
    expect(estimate.seconds).toBe(12); // 11.001 s
    expect(estimate.memoryBytes).toBe(1_001_000);
  });
});

describe("the size a run goes on", () => {
  it("is the one asked for, else the recommended one, else the one with the most memory", () => {
    const fits = estimateRun(500_000, SIZES, TABLE);
    expect(runSize(fits, "big")?.size).toBe("big");
    expect(runSize(fits)?.size).toBe("tiny");
    expect(runSize(estimateRun(7_000_000, SIZES, TABLE))?.size).toBe("big");
    expect(runSize(fits, "nope")).toBeUndefined();
  });
});

describe("the fitted coefficients", () => {
  it("recommend the 16 GiB size for the largest block the M2.11 benchmark solved on 16 GB", () => {
    // 145,471 second-order elements, 207,025 nodes: 8.8 GiB measured with SPOOLES on one thread.
    const sizes: MachineSize[] = [
      { name: "8", cores: 2, memoryBytes: 8 * GiB, ratePerHour: 1 },
      { name: "16", cores: 4, memoryBytes: 16 * GiB, ratePerHour: 2 },
    ];
    const estimate = estimateRun(207_025, sizes);
    expect(estimate.memoryBytes / GiB).toBeGreaterThan(8.5);
    expect(estimate.memoryBytes / GiB).toBeLessThan(9.5);
    expect(estimate.recommended).toBe("16");
  });
});
