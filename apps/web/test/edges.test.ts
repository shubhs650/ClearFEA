// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { closestAlong, edgeSegments, nearestEdge } from "../src/viewer/edges";

// Two edges in the z = 0 plane: a straight one along x and a bent one, seen from above with one
// metre to a hundred pixels.
const edges = [
  { tag: 4, points: [0, 0, 0, 1, 0, 0] },
  { tag: 9, points: [0, 1, 0, 1, 1, 0, 1, 2, 0] },
];
const project = (p: readonly number[]) => ({ x: (p[0] ?? 0) * 100, y: (p[1] ?? 0) * 100, depth: 10 + (p[0] ?? 0) });

describe("edge segments", () => {
  it("turns each polyline into point pairs and keeps whose they are", () => {
    const segments = edgeSegments(edges);
    expect(segments.runs).toEqual([
      { tag: 4, firstPoint: 0, pointCount: 2 },
      { tag: 9, firstPoint: 2, pointCount: 4 },
    ]);
    expect([...segments.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 2, 0]);
  });

  it("finds the closest point along a segment, clamped to its ends", () => {
    expect(closestAlong([5, 3], [0, 0], [10, 0])).toBe(0.5);
    expect(closestAlong([-5, 3], [0, 0], [10, 0])).toBe(0);
    expect(closestAlong([1, 1], [2, 2], [2, 2])).toBe(0);
  });
});

describe("the edge nearest the pointer", () => {
  const segments = edgeSegments(edges);
  const visible = () => false;

  it("picks the edge within the slop and the nearer of two", () => {
    expect(nearestEdge(segments, [50, 4], 8, project, visible)).toBe(4);
    expect(nearestEdge(segments, [104, 150], 8, project, visible)).toBe(9);
    expect(nearestEdge(segments, [50, 50], 8, project, visible)).toBeNull();
    expect(nearestEdge(segments, [50, 60], 50, project, visible)).toBe(9);
  });

  it("leaves out edges behind the surface and points behind the camera", () => {
    // Points further than 10.5 from the camera are hidden: the straight edge's far half.
    const hidden = (depth: number) => depth > 10.5;
    expect(nearestEdge(segments, [20, 2], 8, project, hidden)).toBe(4);
    expect(nearestEdge(segments, [80, 2], 8, project, hidden)).toBeNull();
    expect(nearestEdge(segments, [50, 2], 8, () => null, visible)).toBeNull();
  });
});
