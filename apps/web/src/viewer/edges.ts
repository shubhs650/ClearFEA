// SPDX-License-Identifier: AGPL-3.0-or-later
// Edges of a geometry for the viewer (M2.8): the polylines topology.json lists for each edge,
// turned into line segments to draw, and the edge nearest the pointer on screen to pick.

/** An edge as topology.json lists it: its tag and a polyline (x, y, z per point, in metres). */
export type EdgePolyline = { tag: number; points: readonly number[] };

/** Line segments of every edge (two points each) and which run of segment points is whose. */
export type EdgeSegments = {
  positions: Float32Array;
  runs: { tag: number; firstPoint: number; pointCount: number }[];
};

export function edgeSegments(edges: readonly EdgePolyline[]): EdgeSegments {
  const positions: number[] = [];
  const runs: EdgeSegments["runs"] = [];
  for (const edge of edges) {
    const firstPoint = positions.length / 3;
    const points = Math.floor(edge.points.length / 3);
    for (let k = 0; k + 1 < points; k++) {
      for (const p of [k, k + 1]) {
        positions.push(edge.points[p * 3] ?? 0, edge.points[p * 3 + 1] ?? 0, edge.points[p * 3 + 2] ?? 0);
      }
    }
    runs.push({ tag: edge.tag, firstPoint, pointCount: positions.length / 3 - firstPoint });
  }
  return { positions: new Float32Array(positions), runs };
}

/** Where along the segment a to b the point p is closest, from 0 at a to 1 at b. */
export function closestAlong(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  let along = 0;
  let length = 0;
  for (let i = 0; i < p.length; i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    along += ((p[i] ?? 0) - (a[i] ?? 0)) * d;
    length += d * d;
  }
  return length === 0 ? 0 : Math.min(Math.max(along / length, 0), 1);
}

/**
 * The tag of the edge whose segment passes nearest the pointer on screen, within `slop` pixels,
 * or null. `project` maps a world point to screen pixels and its distance from the camera, or
 * null when it is behind the camera; `hidden` says whether a point at that distance is behind the
 * model's surface, so edges on the far side are not picked.
 */
export function nearestEdge(
  segments: EdgeSegments,
  pointer: readonly [number, number],
  slop: number,
  project: (point: readonly number[]) => { x: number; y: number; depth: number } | null,
  hidden: (depth: number) => boolean,
): number | null {
  let best: number | null = null;
  let bestDistance = slop;
  const { positions } = segments;
  for (const run of segments.runs) {
    for (let k = run.firstPoint; k + 1 < run.firstPoint + run.pointCount; k += 2) {
      const a = [positions[k * 3] ?? 0, positions[k * 3 + 1] ?? 0, positions[k * 3 + 2] ?? 0];
      const b = [positions[k * 3 + 3] ?? 0, positions[k * 3 + 4] ?? 0, positions[k * 3 + 5] ?? 0];
      const sa = project(a);
      const sb = project(b);
      if (sa === null || sb === null) continue;
      const t = closestAlong(pointer, [sa.x, sa.y], [sb.x, sb.y]);
      const x = sa.x + (sb.x - sa.x) * t;
      const y = sa.y + (sb.y - sa.y) * t;
      const distance = Math.hypot(pointer[0] - x, pointer[1] - y);
      if (distance >= bestDistance) continue;
      if (hidden(sa.depth + (sb.depth - sa.depth) * t)) continue;
      best = run.tag;
      bestDistance = distance;
    }
  }
  return best;
}
