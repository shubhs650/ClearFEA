// SPDX-License-Identifier: AGPL-3.0-or-later
// Reader for the display mesh file (display.bin), format in packages/spec/display-mesh.md.
// The worker writes it (worker/clearfea_worker/geometry/display.py); both sides are tested
// against packages/spec/fixtures/display-two-faces.bin.

const MAGIC = "CFDM";
const VERSION = 1;
const HEADER_BYTES = 20;
const FACE_BYTES = 20;

/** One face's run of vertices and triangles in the shared arrays. */
export type DisplayFace = {
  tag: number;
  firstVertex: number;
  vertexCount: number;
  firstTriangle: number;
  triangleCount: number;
};

export type DisplayMesh = {
  /** x, y, z per vertex, in metres. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** In ascending tag order; triangle runs follow each other without gaps. */
  faces: DisplayFace[];
};

export class DisplayMeshError extends Error {}

const broken = (why: string) =>
  new DisplayMeshError(
    `The display mesh of this geometry is damaged (${why}). Upload the STEP file again; if it happens again, report it as a bug.`,
  );

/** Reads and checks a display.bin file. Throws DisplayMeshError with a user-facing message. */
export function parseDisplayMesh(buffer: ArrayBuffer): DisplayMesh {
  if (buffer.byteLength < HEADER_BYTES) throw broken("the file is shorter than its header");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== MAGIC) throw broken("it does not start with CFDM");
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new DisplayMeshError(
      `The display mesh is format version ${version}, but this viewer reads only version ${VERSION}. Reload the page to get the current viewer.`,
    );
  }
  const vertexCount = view.getUint32(8, true);
  const triangleCount = view.getUint32(12, true);
  const faceCount = view.getUint32(16, true);
  const positionsStart = HEADER_BYTES;
  const indicesStart = positionsStart + vertexCount * 12;
  const facesStart = indicesStart + triangleCount * 12;
  if (facesStart + faceCount * FACE_BYTES !== buffer.byteLength) {
    throw broken(`its ${buffer.byteLength} bytes do not match its header`);
  }

  // Copy the arrays so they do not depend on the input's alignment or byte order.
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < positions.length; i++) {
    positions[i] = view.getFloat32(positionsStart + i * 4, true);
  }
  const indices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < indices.length; i++) {
    indices[i] = view.getUint32(indicesStart + i * 4, true);
  }

  const faces: DisplayFace[] = [];
  let nextTriangle = 0;
  for (let k = 0; k < faceCount; k++) {
    const at = facesStart + k * FACE_BYTES;
    const face: DisplayFace = {
      tag: view.getInt32(at, true),
      firstVertex: view.getUint32(at + 4, true),
      vertexCount: view.getUint32(at + 8, true),
      firstTriangle: view.getUint32(at + 12, true),
      triangleCount: view.getUint32(at + 16, true),
    };
    const previous = faces[faces.length - 1];
    if (previous !== undefined && face.tag <= previous.tag) {
      throw broken("its faces are not in ascending tag order");
    }
    if (face.firstTriangle !== nextTriangle) throw broken(`face ${face.tag} leaves a gap`);
    nextTriangle += face.triangleCount;
    if (face.firstVertex + face.vertexCount > vertexCount || nextTriangle > triangleCount) {
      throw broken(`face ${face.tag} runs past the end of the arrays`);
    }
    const end = face.firstVertex + face.vertexCount;
    for (let i = face.firstTriangle * 3; i < nextTriangle * 3; i++) {
      const index = indices[i] ?? -1;
      if (index < face.firstVertex || index >= end) {
        throw broken(`face ${face.tag} uses vertices outside its own range`);
      }
    }
    faces.push(face);
  }
  if (nextTriangle !== triangleCount) throw broken("some triangles belong to no face");
  return { positions, indices, faces };
}

/** The face that owns a triangle, found by its triangle range; null if out of range. */
export function faceAtTriangle(mesh: DisplayMesh, triangle: number): DisplayFace | null {
  let low = 0;
  let high = mesh.faces.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const face = mesh.faces[middle];
    if (face === undefined) return null;
    if (triangle < face.firstTriangle) high = middle - 1;
    else if (triangle >= face.firstTriangle + face.triangleCount) low = middle + 1;
    else return face;
  }
  return null;
}

/**
 * The outline of every face: each triangle edge that only one triangle of its face uses.
 * Returned as line segments (two x, y, z points each), ready for a three.js LineSegments.
 */
export function faceOutlines(mesh: DisplayMesh): Float32Array {
  const { positions, indices } = mesh;
  const segments: number[] = [];
  for (const face of mesh.faces) {
    const uses = new Map<number, number>();
    const span = face.vertexCount;
    const key = (a: number, b: number) => (a < b ? a * span + b : b * span + a);
    for (let t = face.firstTriangle; t < face.firstTriangle + face.triangleCount; t++) {
      for (let e = 0; e < 3; e++) {
        const a = (indices[t * 3 + e] ?? 0) - face.firstVertex;
        const b = (indices[t * 3 + ((e + 1) % 3)] ?? 0) - face.firstVertex;
        const k = key(a, b);
        uses.set(k, (uses.get(k) ?? 0) + 1);
      }
    }
    for (const [k, count] of uses) {
      if (count !== 1) continue;
      for (const local of [Math.floor(k / span), k % span]) {
        const v = (face.firstVertex + local) * 3;
        segments.push(positions[v] ?? 0, positions[v + 1] ?? 0, positions[v + 2] ?? 0);
      }
    }
  }
  return new Float32Array(segments);
}

/**
 * Every triangle edge of every face, once per face: the element edges of an analysis mesh's
 * surface. Returned as line segments, like faceOutlines.
 */
export function triangleEdges(mesh: DisplayMesh): Float32Array {
  const { positions, indices } = mesh;
  const segments: number[] = [];
  for (const face of mesh.faces) {
    const seen = new Set<number>();
    const span = face.vertexCount;
    for (let t = face.firstTriangle; t < face.firstTriangle + face.triangleCount; t++) {
      for (let e = 0; e < 3; e++) {
        const a = indices[t * 3 + e] ?? 0;
        const b = indices[t * 3 + ((e + 1) % 3)] ?? 0;
        const la = a - face.firstVertex;
        const lb = b - face.firstVertex;
        const k = la < lb ? la * span + lb : lb * span + la;
        if (seen.has(k)) continue;
        seen.add(k);
        for (const v of [a * 3, b * 3]) {
          segments.push(positions[v] ?? 0, positions[v + 1] ?? 0, positions[v + 2] ?? 0);
        }
      }
    }
  }
  return new Float32Array(segments);
}
