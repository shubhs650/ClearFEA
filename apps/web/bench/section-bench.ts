// SPDX-License-Identifier: AGPL-3.0-or-later
// Cut plane measurement (M3.4, ADR-053): builds a box of 10-node tetrahedra of about each size
// asked for, in the mesh.bin layout, and times parsing it and cutting it as the viewer does.
// Run from apps/web (the largest needs about 4 GB of heap):
//   node --max-old-space-size=8000 --experimental-strip-types bench/section-bench.ts 25000 170000 2000000
// The box has about the nodes per element of a Gmsh mesh of a stocky part (1.36 here).

import { cutMesh, parseVolumeMesh, sectionPositions, sectionValues } from "../src/viewer/section.ts";
import { boxMesh } from "../test/volumeBox.ts";

const time = (f: () => void) => {
  const start = performance.now();
  f();
  return performance.now() - start;
};

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);

/** Float32 values per node in nodes.bin: displacement 3, von Mises 1, stress 6, principal 3, strain 6. */
const NODE_VALUES = 19;

console.log(
  "| elements | nodes | mesh.bin MB | one scalar field MB | nodes.bin MB | parse ms | slowest cut ms | section triangles | colour and place ms |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const arg of process.argv.slice(2)) {
  const buffer = boxMesh(Math.max(1, Math.round(Math.cbrt(Number(arg) / 6))));
  let mesh = parseVolumeMesh(buffer);
  const parse = time(() => {
    mesh = parseVolumeMesh(buffer);
  });
  const values = new Float32Array(mesh.nodeCount).map((_, i) => i);
  const displacement = new Float32Array(mesh.nodeCount * 3);
  let section = cutMesh(mesh, { normal: [1, 0, 0], offset: 0.5 });
  const cuts = (
    [
      [[1, 0, 0], 0.5],
      [[0, 1, 0], 0.37],
      [[0, 0, 1], 0.71],
      [[0.6, 0.8, 0], 0.7],
    ] as const
  ).map(([normal, offset]) =>
    time(() => {
      section = cutMesh(mesh, { normal, offset });
    }),
  );
  const colour = time(() => {
    sectionValues(section, values);
    sectionPositions(section, mesh.positions, displacement, 10);
  });
  console.log(
    `| ${mesh.elementCount.toLocaleString("en-US")} | ${mesh.nodeCount.toLocaleString("en-US")} | ${mb(buffer.byteLength)} | ${mb(mesh.nodeCount * 4)} | ${mb(mesh.nodeCount * 4 * NODE_VALUES)} | ${parse.toFixed(0)} | ${Math.max(...cuts).toFixed(0)} | ${(section.triangles.length / 3).toLocaleString("en-US")} | ${colour.toFixed(0)} |`,
  );
}
