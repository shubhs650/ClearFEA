// SPDX-License-Identifier: AGPL-3.0-or-later
// A unit cube of n × n × n cells, each split into six tetrahedra the way Gmsh splits a cube,
// written in the mesh.bin layout (packages/spec/volume-mesh.md) with no bodies or faces. Used
// by the cut plane tests and the cut plane measurement (bench/section-bench.ts, ADR-053). No
// imports, so Node can run the measurement straight from the TypeScript source.

/** The six tetrahedra of a cube, by corner (bit 0 = x, bit 1 = y, bit 2 = z). */
const CUBE_TETS = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7],
] as const;

/** Gmsh's mid-edge nodes of a 10-node tetrahedron: edges (0,1), (1,2), (2,0), (3,0), (3,2), (3,1). */
const EDGES = [
  [0, 1],
  [1, 2],
  [2, 0],
  [3, 0],
  [3, 2],
  [3, 1],
] as const;

export function boxMesh(n: number, order: 1 | 2 = 2): ArrayBuffer {
  const side = n + 1;
  const corner = (i: number, j: number, k: number) => i + side * (j + side * k);
  const cornerCount = side ** 3;
  const positions: number[] = [];
  for (let k = 0; k < side; k++) {
    for (let j = 0; j < side; j++) {
      for (let i = 0; i < side; i++) positions.push(i / n, j / n, k / n);
    }
  }
  const mid = new Map<number, number>();
  let nodeCount = cornerCount;
  const midNode = (a: number, b: number) => {
    const key = Math.min(a, b) * cornerCount + Math.max(a, b);
    let m = mid.get(key);
    if (m === undefined) {
      m = nodeCount++;
      mid.set(key, m);
      for (let x = 0; x < 3; x++) positions.push(((positions[3 * a + x] ?? 0) + (positions[3 * b + x] ?? 0)) / 2);
    }
    return m;
  };
  const elements: number[] = [];
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const at = (bits: number) => corner(i + (bits & 1), j + ((bits >> 1) & 1), k + ((bits >> 2) & 1));
        for (const tet of CUBE_TETS) {
          const nodes = tet.map(at);
          for (const node of nodes) elements.push(node);
          if (order === 2) for (const [a, b] of EDGES) elements.push(midNode(nodes[a] ?? 0, nodes[b] ?? 0));
        }
      }
    }
  }
  const npe = order === 1 ? 4 : 10;
  const buffer = new ArrayBuffer(32 + nodeCount * 24 + elements.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, "CFVM".charCodeAt(i));
  [1, order, nodeCount, elements.length / npe, 0, 0, 0].forEach((v, i) => {
    view.setUint32(4 + 4 * i, v, true);
  });
  new Float64Array(buffer, 32, nodeCount * 3).set(positions);
  new Uint32Array(buffer, 32 + nodeCount * 24, elements.length).set(elements);
  return buffer;
}
