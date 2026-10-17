// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads the type and pixel size of an uploaded logo from its first bytes (M7.1, ADR-074). Only PNG
// and JPEG are taken: both go into a Word file and a PDF as they are, and neither can carry script.

export interface ImageInfo {
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's type and size, or null when it is not a PNG or JPEG whose size can be read. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && PNG.every((b, i) => bytes[i] === b)) {
    // The first chunk is IHDR: length (4), type (4), width (4), height (4).
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
    return sized("image/png", view.getUint32(16), view.getUint32(20));
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the segments to the first start-of-frame marker, which holds height then width.
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] ?? 0;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame) {
        if (at + 9 > bytes.length) return null;
        return sized("image/jpeg", view.getUint16(at + 7), view.getUint16(at + 5));
      }
      if (length < 2) return null;
      at += 2 + length;
    }
  }
  return null;
}

function sized(contentType: ImageInfo["contentType"], width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 ? { contentType, width, height } : null;
}
