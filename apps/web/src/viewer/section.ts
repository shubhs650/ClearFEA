// SPDX-License-Identifier: AGPL-3.0-or-later
// Cut planes (M3.4, ADR-053): the section of a run's volume mesh by a plane, computed in the
// browser from the run's mesh.bin (packages/spec/volume-mesh.md). A 10-node tetrahedron is
// split into eight 4-node tetrahedra through its mid-edge nodes, so curved elements and the
// mid-edge nodes' values take part, and each small tetrahedron is cut by the plane. Every
// section vertex lies on an edge between two mesh nodes, so it is stored as those two nodes
// and how far along it is: any nodal field (and the deformed shape) is then drawn on the
// section by linear interpolation along that edge, without cutting again.

const MAGIC = "CFVM";
const VERSION = 1;
const HEADER_BYTES = 32;

/** The volume mesh as the cut needs it: nodes and element connectivity, 0-based. */
export type VolumeMesh = {
  order: 1 | 2;
  nodeCount: number;
  elementCount: number;
  /** x, y, z per node, in metres. */
  positions: Float64Array;
  /** 4 or 10 node indices per element, in Gmsh's node order. */
  elements: Uint32Array;
};

export class VolumeMeshError extends Error {}

const broken = (why: string) =>
  new VolumeMeshError(
    `The mesh file of this run is damaged (${why}). Run the simulation again; if it happens again, report it as a bug.`,
  );

/** Reads and checks a mesh.bin file. Throws VolumeMeshError with a user-facing message. */
export function parseVolumeMesh(buffer: ArrayBuffer): VolumeMesh {
  if (buffer.byteLength < HEADER_BYTES) throw broken("the file is shorter than its header");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== MAGIC) throw broken("it does not start with CFVM");
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new VolumeMeshError(
      `The mesh file is format version ${version}, but this viewer reads only version ${VERSION}. Reload the page to get the current viewer.`,
    );
  }
  const order = view.getUint32(8, true);
  if (order !== 1 && order !== 2) throw broken(`its element order ${order} is not 1 or 2`);
  const nodeCount = view.getUint32(12, true);
  const elementCount = view.getUint32(16, true);
  const bodyCount = view.getUint32(20, true);
  const faceCount = view.getUint32(24, true);
  const entryCount = view.getUint32(28, true);
  const npe = order === 1 ? 4 : 10;
  const elementsStart = HEADER_BYTES + nodeCount * 24;
  const expected = elementsStart + elementCount * npe * 4 + (bodyCount + faceCount) * 12 + entryCount * 8;
  if (expected !== buffer.byteLength) throw broken(`its ${buffer.byteLength} bytes do not match its header`);
  // The header keeps positions on an 8-byte boundary, so the arrays are views, not copies,
  // on a little-endian machine (every browser ClearFEA supports).
  const positions = new Float64Array(buffer, HEADER_BYTES, nodeCount * 3);
  const elements = new Uint32Array(buffer, elementsStart, elementCount * npe);
  for (let i = 0; i < elements.length; i++) {
    if ((elements[i] ?? 0) >= nodeCount) throw broken("an element uses a node that does not exist");
  }
  return { order, nodeCount, elementCount, positions, elements };
}

/** A cut plane: the points x with normal · x = offset; the side normal · x > offset is cut away. */
export type Plane = { normal: readonly [number, number, number]; offset: number };

/**
 * The section: vertex v lies on the mesh edge from node `from[v]` to node `to[v]`, a fraction
 * `t[v]` of the way along it, at `points[3v..3v+2]` on the undeformed mesh, and `triangles`
 * holds three vertex indices per triangle, counter-clockwise seen from the cut-away side.
 */
export type Section = {
  from: Uint32Array;
  to: Uint32Array;
  t: Float32Array;
  points: Float32Array;
  triangles: Uint32Array;
  /** Elements the plane passes through. */
  elementsCut: number;
};

/** The eight 4-node tetrahedra of a 10-node one, in Gmsh's node numbering: four at the
 * corners and four around the diagonal between mid-edge nodes 4 (edge 0-1) and 8 (edge 3-2). */
const SUB_TETS = [
  [0, 4, 6, 7],
  [4, 1, 5, 9],
  [6, 5, 2, 8],
  [7, 9, 8, 3],
  [4, 8, 5, 9],
  [4, 8, 9, 7],
  [4, 8, 7, 6],
  [4, 8, 6, 5],
] as const;
const LINEAR = [[0, 1, 2, 3]] as const;

/** A growable typed array. */
class Grow<T extends Uint32Array | Float32Array> {
  length = 0;
  data: T;
  private readonly make: (n: number) => T;
  constructor(data: T, make: (n: number) => T) {
    this.data = data;
    this.make = make;
  }
  push(value: number): void {
    if (this.length === this.data.length) {
      const bigger = this.make(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = value;
  }
  done(): T {
    return this.data.slice(0, this.length) as T;
  }
}

/** Cuts the mesh by the plane. */
export function cutMesh(mesh: VolumeMesh, plane: Plane): Section {
  const { positions, elements, nodeCount } = mesh;
  const [nx, ny, nz] = plane.normal;
  const distance = new Float64Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    distance[n] = nx * (positions[3 * n] ?? 0) + ny * (positions[3 * n + 1] ?? 0) + nz * (positions[3 * n + 2] ?? 0) - plane.offset;
  }
  const from = new Grow(new Uint32Array(1024), (n) => new Uint32Array(n));
  const to = new Grow(new Uint32Array(1024), (n) => new Uint32Array(n));
  const t = new Grow(new Float32Array(1024), (n) => new Float32Array(n));
  const points = new Grow(new Float32Array(3072), (n) => new Float32Array(n));
  const triangles = new Grow(new Uint32Array(3072), (n) => new Uint32Array(n));
  // One section vertex per cut mesh edge, shared by the triangles on both sides of it.
  const vertexOfEdge = new Map<number, number>();
  const vertex = (a: number, b: number): number => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * nodeCount + hi;
    let v = vertexOfEdge.get(key);
    if (v === undefined) {
      v = from.length;
      vertexOfEdge.set(key, v);
      const dl = distance[lo] ?? 0;
      const dh = distance[hi] ?? 0;
      const f = dl / (dl - dh);
      from.push(lo);
      to.push(hi);
      t.push(f);
      for (let i = 0; i < 3; i++) {
        const pl = positions[3 * lo + i] ?? 0;
        points.push(pl + f * ((positions[3 * hi + i] ?? 0) - pl));
      }
    }
    return v;
  };
  /** Adds a triangle, turned to face the cut-away side so the section is lit from there. */
  const triangle = (a: number, b: number, c: number): void => {
    const p = points.data;
    const ux = (p[3 * b] ?? 0) - (p[3 * a] ?? 0);
    const uy = (p[3 * b + 1] ?? 0) - (p[3 * a + 1] ?? 0);
    const uz = (p[3 * b + 2] ?? 0) - (p[3 * a + 2] ?? 0);
    const vx = (p[3 * c] ?? 0) - (p[3 * a] ?? 0);
    const vy = (p[3 * c + 1] ?? 0) - (p[3 * a + 1] ?? 0);
    const vz = (p[3 * c + 2] ?? 0) - (p[3 * a + 2] ?? 0);
    const facing = nx * (uy * vz - uz * vy) + ny * (uz * vx - ux * vz) + nz * (ux * vy - uy * vx);
    // A plane through nodes leaves triangles of no area; they draw nothing.
    if (facing === 0) return;
    triangles.push(a);
    triangles.push(facing < 0 ? c : b);
    triangles.push(facing < 0 ? b : c);
  };

  const npe = mesh.order === 1 ? 4 : 10;
  const tets = mesh.order === 1 ? LINEAR : SUB_TETS;
  const above: number[] = [];
  const below: number[] = [];
  let elementsCut = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    // A node exactly on the plane counts as cut away, so every cut edge has one node on each side.
    let some = false;
    let all = true;
    for (let k = 0; k < npe; k++) {
      const up = (distance[elements[base + k] ?? 0] ?? 0) >= 0;
      some ||= up;
      all &&= up;
    }
    if (!some || all) continue;
    elementsCut++;
    for (const tet of tets) {
      above.length = 0;
      below.length = 0;
      for (const k of tet) {
        const node = elements[base + k] ?? 0;
        ((distance[node] ?? 0) >= 0 ? above : below).push(node);
      }
      if (above.length === 0 || below.length === 0) continue;
      if (above.length === 2) {
        const [a = 0, b = 0] = above;
        const [c = 0, d = 0] = below;
        // The four cut edges a-c, a-d, b-d, b-c go round the quadrilateral in order.
        const ac = vertex(a, c);
        const ad = vertex(a, d);
        const bd = vertex(b, d);
        const bc = vertex(b, c);
        triangle(ac, ad, bd);
        triangle(ac, bd, bc);
      } else {
        const [lone, others] = above.length === 1 ? [above[0] ?? 0, below] : [below[0] ?? 0, above];
        triangle(vertex(lone, others[0] ?? 0), vertex(lone, others[1] ?? 0), vertex(lone, others[2] ?? 0));
      }
    }
  }
  return {
    from: from.done(),
    to: to.done(),
    t: t.done(),
    points: points.done(),
    triangles: triangles.done(),
    elementsCut,
  };
}

/** One value per section vertex from one value per mesh node, interpolated along each cut edge. */
export function sectionValues(section: Section, nodeValues: Float32Array): Float32Array {
  const out = new Float32Array(section.t.length);
  for (let v = 0; v < out.length; v++) {
    const a = nodeValues[section.from[v] ?? 0] ?? 0;
    const b = nodeValues[section.to[v] ?? 0] ?? 0;
    out[v] = a + (section.t[v] ?? 0) * (b - a);
  }
  return out;
}

/** Section vertex positions, x + scale · u interpolated along each cut edge; without a
 * displacement (three values per node), the undeformed positions. */
export function sectionPositions(
  section: Section,
  positions: Float64Array,
  displacement: Float32Array | null,
  scale: number,
): Float32Array {
  const out = new Float32Array(section.t.length * 3);
  for (let v = 0; v < section.t.length; v++) {
    const a = section.from[v] ?? 0;
    const b = section.to[v] ?? 0;
    const f = section.t[v] ?? 0;
    for (let i = 0; i < 3; i++) {
      let pa = positions[3 * a + i] ?? 0;
      let pb = positions[3 * b + i] ?? 0;
      if (displacement !== null) {
        pa += scale * (displacement[3 * a + i] ?? 0);
        pb += scale * (displacement[3 * b + i] ?? 0);
      }
      out[3 * v + i] = pa + f * (pb - pa);
    }
  }
  return out;
}
