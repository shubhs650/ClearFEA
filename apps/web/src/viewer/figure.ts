// SPDX-License-Identifier: AGPL-3.0-or-later
// Finishes a report figure (M7.2, ADR-011) on a 2D canvas: the viewer's picture with what the
// viewer shows as HTML over it drawn in, so the figure reads like the screen: the legend at the
// top left, the min/max markers at their points, and an axis triad at the bottom left. Sizes are
// for a figure about 16 cm wide on the page.

import type { LegendContent } from "../layout/Viewer";
import type { Snapshot } from "./ModelView";

/** Size of a report figure in pixels: about 250 dpi across a 16 cm column. */
export const FIGURE_WIDTH = 1600;
export const FIGURE_HEIGHT = 1000;

const FONT = "Helvetica, Arial, sans-serif";
const TEXT = "#212529";
const MARKER_COLOURS = { min: "#1864ab", max: "#c92a2a", probe: "#212529" } as const;
const AXIS_COLOURS = ["#c92a2a", "#2b8a3e", "#1864ab"] as const;

/** Draws the snapshot with its legend (for a result plot), markers and axes on a new canvas. */
export function paintFigure(snapshot: Snapshot, legend: LegendContent | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = snapshot.image.width;
  canvas.height = snapshot.image.height;
  const context = canvas.getContext("2d");
  if (context === null) return snapshot.image;
  context.drawImage(snapshot.image, 0, 0);
  for (const { marker, x, y } of snapshot.markers) drawMarker(context, marker.kind, marker.text, x, y);
  if (legend !== null) drawLegend(context, legend);
  drawAxes(context, snapshot.axes, 70, canvas.height - 70);
  return canvas;
}

/** The canvas as PNG bytes. */
export function pngOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob === null ? reject(new Error("The browser could not encode the figure as PNG.")) : resolve(blob)), "image/png");
  });
}

function drawMarker(context: CanvasRenderingContext2D, kind: keyof typeof MARKER_COLOURS, text: string, x: number, y: number) {
  const colour = MARKER_COLOURS[kind];
  context.beginPath();
  context.arc(x, y, 8, 0, 2 * Math.PI);
  context.fillStyle = colour;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.font = `24px ${FONT}`;
  const width = context.measureText(text).width + 16;
  // The label sits up and to the right of the point, kept inside the picture.
  const left = Math.min(x + 12, context.canvas.width - width - 4);
  const top = Math.max(y - 44, 4);
  context.fillStyle = "rgb(255 255 255 / 92%)";
  context.fillRect(left, top, width, 34);
  context.strokeStyle = colour;
  context.strokeRect(left, top, width, 34);
  context.fillStyle = TEXT;
  context.textBaseline = "middle";
  context.fillText(text, left + 8, top + 17);
}

function drawLegend(context: CanvasRenderingContext2D, legend: LegendContent) {
  const left = 24;
  const top = 24;
  const row = 34;
  const swatch = 40;
  context.font = `bold 26px ${FONT}`;
  const titleWidth = context.measureText(legend.title).width;
  context.font = `24px ${FONT}`;
  const rowWidth = Math.max(0, ...legend.rows.map((r) => context.measureText(r.text).width)) + swatch + 12;
  context.font = `20px ${FONT}`;
  const noteWidth = Math.max(0, ...legend.notes.map((n) => context.measureText(n).width));
  const width = Math.max(titleWidth, rowWidth, noteWidth) + 32;
  const height = 16 + 38 + legend.rows.length * row + legend.notes.length * 30 + 16;
  context.fillStyle = "rgb(255 255 255 / 92%)";
  context.fillRect(left, top, width, height);
  context.lineWidth = 1;
  context.strokeStyle = "#ced4da";
  context.strokeRect(left, top, width, height);
  context.textBaseline = "middle";
  context.fillStyle = TEXT;
  context.font = `bold 26px ${FONT}`;
  context.fillText(legend.title, left + 16, top + 16 + 17);
  let y = top + 16 + 38;
  context.font = `24px ${FONT}`;
  for (const { colour, text } of legend.rows) {
    context.fillStyle = colour;
    context.fillRect(left + 16, y + 3, swatch, row - 6);
    context.fillStyle = TEXT;
    context.fillText(text, left + 16 + swatch + 12, y + row / 2);
    y += row;
  }
  context.font = `20px ${FONT}`;
  for (const note of legend.notes) {
    context.fillText(note, left + 16, y + 15);
    y += 30;
  }
}

function drawAxes(context: CanvasRenderingContext2D, axes: [number, number][], x: number, y: number) {
  const length = 48;
  context.lineWidth = 4;
  context.font = `bold 22px ${FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  ["x", "y", "z"].forEach((name, k) => {
    const [dx, dy] = axes[k] ?? [0, 0];
    const colour = AXIS_COLOURS[k] ?? TEXT;
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + dx * length, y + dy * length);
    context.stroke();
    context.fillText(name, x + dx * (length + 16), y + dy * (length + 16));
  });
  context.textAlign = "start";
}
