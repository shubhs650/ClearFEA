// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads binary fixtures from packages/spec/fixtures. Node types are referenced here only,
// so source files under src/ cannot use Node APIs by accident.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readFixture(name: string): ArrayBuffer {
  const bytes = readFileSync(join(import.meta.dirname, "../../../packages/spec/fixtures", name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
