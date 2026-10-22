// SPDX-License-Identifier: AGPL-3.0-or-later
// A project's thumbnail for the home page (M14.3, ADR-114): its geometry drawn by a ModelView off
// screen, the same renderer the user looks at, from the isometric view, and stored on the project.

import type { ProjectView } from "@clearfea/spec";
import { fetchDisplayMesh } from "../api/geometries";
import { uploadThumbnail } from "../api/projects";
import type { ApiResult } from "../api/request";
import { parseDisplayMesh } from "../viewer/displayMesh";
import { pngOf } from "../viewer/figure";
import { ModelView } from "../viewer/ModelView";

/** Size of a thumbnail in pixels: twice a card's width, so it is sharp on a high-density screen. */
export const THUMBNAIL_WIDTH = 480;
export const THUMBNAIL_HEIGHT = 300;

/** Draws the geometry and stores the picture as the project's thumbnail. */
export async function storeThumbnail(projectId: string, geometryId: string): Promise<ApiResult<ProjectView>> {
  const display = await fetchDisplayMesh(geometryId);
  if (display.kind !== "ok") return display;
  let mesh: ReturnType<typeof parseDisplayMesh>;
  try {
    mesh = parseDisplayMesh(display.value);
  } catch (error) {
    return { kind: "error", problem: error instanceof Error ? error.message : String(error) };
  }
  // Off screen at the thumbnail's size: a hidden element has no size to draw at.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: `${THUMBNAIL_WIDTH}px`,
    height: `${THUMBNAIL_HEIGHT}px`,
  });
  document.body.appendChild(host);
  let image: Blob;
  try {
    const view = new ModelView(host, { onHover: () => {}, onPick: () => {} }, { pixelRatio: 1, background: "#eef1f5" });
    try {
      view.setMesh(mesh, "outlines", false);
      image = await pngOf(view.snapshot().image);
    } finally {
      view.dispose();
    }
  } catch (error) {
    return { kind: "error", problem: error instanceof Error ? error.message : String(error) };
  } finally {
    host.remove();
  }
  return uploadThumbnail(projectId, image);
}
