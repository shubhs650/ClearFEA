// SPDX-License-Identifier: AGPL-3.0-or-later
import { type EstimatorTable, estimatorTable, STATIC_RUN } from "@clearfea/spec";
import { describe, expect, it } from "vitest";
import { estimateRun, type MachineSize, runSize } from "../src/billing/estimate";

const GiB = 2 ** 30;

/** Round numbers, so the expected values can be worked out by hand. */
const MODEL: EstimatorTable["analyses"]["linear_static"]["pastix"] = {
  solver: "test",
  // 1,000 bytes per node; 10 s plus 1 ms per node.
  peakMemoryBytes: { constant: 0, coefficient: 1000, exponent: 1, largestRatio: 1 },
  jobSecondsByOrder: {
    order1: { constant: 10, coefficient: 0.001, exponent: 1, largestRatio: 1 },
    order2: { constant: 10, coefficient: 0.001, exponent: 1, largestRatio: 1 },
  },
  fittedNodes: [1000, 1_000_000],
  maxElements: { order1: 1_000_000, order2: 100_000 },
};

const TABLE: EstimatorTable = {
  ...estimatorTable,
  version: 7,
  analyses: {
    linear_static: {
      pastix: MODEL,
      spooles: MODEL,
      iterative_cholesky: MODEL,
      // Half the memory of the others, for telling the solvers apart.
      iterative_scaling: {
        ...MODEL,
        peakMemoryBytes: { constant: 0, coefficient: 500, exponent: 1, largestRatio: 1 },
      },
    },
    modal: {
      // The static model's figures plus, per mode, 100 bytes and 0.1 ms per node.
      spooles: {
        ...MODEL,
        jobSeconds: { constant: 10, coefficient: 0.001, exponent: 1, largestRatio: 1 },
        peakMemoryBytesPerMode: { constant: 0, coefficient: 100, exponent: 1, largestRatio: 1 },
        jobSecondsPerMode: { constant: 0, coefficient: 0.0001, exponent: 1, largestRatio: 1 },
        fittedModes: [1, 100],
      },
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
    const estimate = estimateRun(500_000, 2, SIZES, "pastix", STATIC_RUN, TABLE);
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
      solver: "pastix",
      analysis: "linear_static",
    });
  });

  it("adds a modal run's part per mode and says how many modes it is for (M6.3)", () => {
    // 100,000 nodes and 20 modes: 100 MB + 20 × 10 MB, and 110 s + 20 × 10 s.
    const estimate = estimateRun(100_000, 2, SIZES, "spooles", { analysis: "modal", modes: 20 }, TABLE);
    expect(estimate.memoryBytes).toBe(300_000_000);
    expect(estimate.seconds).toBe(310);
    expect(estimate.analysis).toBe("modal");
    expect(estimate.modes).toBe(20);
    expect(estimate.extrapolated).toBe(false);
    expect(estimateRun(100_000, 2, SIZES, "spooles", { analysis: "modal", modes: 101 }, TABLE).extrapolated).toBe(true);
  });

  it("refuses a solver with no modal model for a modal run", () => {
    expect(() => estimateRun(100_000, 2, SIZES, "pastix", { analysis: "modal", modes: 10 }, TABLE)).toThrow(
      "PaStiX cannot solve a modal analysis. Choose SPOOLES as the equation solver.",
    );
  });

  it("estimates a thermal run with the linear static model", () => {
    const thermal = estimateRun(100_000, 2, SIZES, "pastix", { analysis: "steady_thermal" }, TABLE);
    expect(thermal.memoryBytes).toBe(estimateRun(100_000, 2, SIZES, "pastix", STATIC_RUN, TABLE).memoryBytes);
    expect(thermal.analysis).toBe("steady_thermal");
  });

  it("is for the solver asked for", () => {
    const estimate = estimateRun(500_000, 2, SIZES, "iterative_scaling", STATIC_RUN, TABLE);
    expect(estimate.solver).toBe("iterative_scaling");
    expect(estimate.memoryBytes).toBe(250_000_000);
  });

  it("times a static run with the law of its mesh's element order (M8.9)", () => {
    const table: EstimatorTable = {
      ...TABLE,
      analyses: {
        ...TABLE.analyses,
        linear_static: {
          ...TABLE.analyses.linear_static,
          // 1 s plus 0.1 ms per node for four-node meshes.
          pastix: {
            ...MODEL,
            jobSecondsByOrder: {
              ...MODEL.jobSecondsByOrder,
              order1: { constant: 1, coefficient: 0.0001, exponent: 1, largestRatio: 1 },
            },
          },
        },
      },
    };
    expect(estimateRun(500_000, 1, SIZES, "pastix", STATIC_RUN, table).seconds).toBe(51);
    expect(estimateRun(500_000, 2, SIZES, "pastix", STATIC_RUN, table).seconds).toBe(510);
  });

  it("is conservative on memory: the margin decides when a size stops fitting", () => {
    // tiny holds 0.8 GiB = 858,993,459 bytes for the solver; with the 1.25 margin a peak of up to
    // 687,194,767 bytes fits.
    expect(estimateRun(687_194, 2, SIZES, "pastix", STATIC_RUN, TABLE).recommended).toBe("tiny");
    expect(estimateRun(687_195, 2, SIZES, "pastix", STATIC_RUN, TABLE).recommended).toBe("big");
  });

  it("recommends nothing when no size fits, and says when the mesh is past the fitted range", () => {
    const estimate = estimateRun(7_000_000, 2, SIZES, "pastix", STATIC_RUN, TABLE);
    expect(estimate.recommended).toBeNull();
    expect(estimate.extrapolated).toBe(true);
    expect(estimate.sizes.every((s) => !s.fits)).toBe(true);
  });

  it("rounds memory and time up", () => {
    const estimate = estimateRun(1001, 2, SIZES, "pastix", STATIC_RUN, TABLE);
    expect(estimate.seconds).toBe(12); // 11.001 s
    expect(estimate.memoryBytes).toBe(1_001_000);
  });
});

describe("the size a run goes on", () => {
  it("is the one asked for, else the recommended one, else the one with the most memory", () => {
    const fits = estimateRun(500_000, 2, SIZES, "pastix", STATIC_RUN, TABLE);
    expect(runSize(fits, "big")?.size).toBe("big");
    expect(runSize(fits)?.size).toBe("tiny");
    expect(runSize(estimateRun(7_000_000, 2, SIZES, "pastix", STATIC_RUN, TABLE))?.size).toBe("big");
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
    const estimate = estimateRun(207_025, 2, sizes, "spooles");
    expect(estimate.memoryBytes / GiB).toBeGreaterThan(8.5);
    expect(estimate.memoryBytes / GiB).toBeLessThan(9.5);
    expect(estimate.recommended).toBe("16");
  });
});
