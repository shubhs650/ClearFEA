// SPDX-License-Identifier: AGPL-3.0-or-later
// The view cube and axis triad of the interactive viewer (UI redesign, ADR-094). Both follow the
// camera: ModelView reports its direction after every redraw and these set a CSS transform on
// their own elements, so orbiting re-renders no React tree. A click on a face of the cube looks at
// the model from that side (y is up, as in the viewer's isometric view); the button under it goes
// back to the isometric view.

import { Home } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CameraBasis } from "./ModelView";

/** Subscribes to the camera's direction; returns a function that unsubscribes. */
export type CameraSubscribe = (listener: (basis: CameraBasis) => void) => () => void;

type Direction = readonly [number, number, number];

/** The faces of the cube: the direction the camera looks from, and how to place the face in
 * the cube's CSS space, where x is right, y is down and z points at the viewer. */
const FACES: { label: string; from: Direction; transform: string }[] = [
  { label: "Front", from: [0, 0, 1], transform: "translateZ(var(--cube-half))" },
  { label: "Back", from: [0, 0, -1], transform: "rotateY(180deg) translateZ(var(--cube-half))" },
  { label: "Right", from: [1, 0, 0], transform: "rotateY(90deg) translateZ(var(--cube-half))" },
  { label: "Left", from: [-1, 0, 0], transform: "rotateY(-90deg) translateZ(var(--cube-half))" },
  { label: "Top", from: [0, 1, 0], transform: "rotateX(90deg) translateZ(var(--cube-half))" },
  { label: "Bottom", from: [0, -1, 0], transform: "rotateX(-90deg) translateZ(var(--cube-half))" },
];

/**
 * The CSS matrix that turns the cube as the world is seen: S·Rᵀ·S, with R the camera's rotation
 * (columns right, up, back) and S flipping y, since CSS y points down.
 */
export function cubeMatrix({ right, up, back }: CameraBasis): string {
  const [rx, ry, rz] = right;
  const [ux, uy, uz] = up;
  const [bx, by, bz] = back;
  // matrix3d takes columns.
  return `matrix3d(${rx},${-ux},${bx},0,${-ry},${uy},${-by},0,${rz},${-uz},${bz},0,0,0,0,1)`;
}

/** Where the world's x, y and z axes point on screen (y down) and how far toward the viewer. */
export function axesOnScreen({ right, up, back }: CameraBasis): { x: number; y: number; depth: number }[] {
  return [0, 1, 2].map((axis) => ({ x: right[axis] ?? 0, y: -(up[axis] ?? 0), depth: back[axis] ?? 0 }));
}

export function ViewCube({
  subscribe,
  onLookFrom,
  onIsometric,
}: {
  subscribe: CameraSubscribe | null;
  onLookFrom: (from: Direction) => void;
  onIsometric: () => void;
}) {
  const cube = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (subscribe === null) return;
    return subscribe((basis) => {
      if (cube.current) cube.current.style.transform = cubeMatrix(basis);
    });
  }, [subscribe]);
  return (
    <fieldset className="view-cube" aria-label="View cube">
      <div className="view-cube-stage">
        <div className="view-cube-body" ref={cube}>
          {FACES.map((face) => (
            <button
              key={face.label}
              type="button"
              className="view-cube-face"
              style={{ transform: face.transform }}
              title={`Look from the ${face.label.toLowerCase()}`}
              aria-label={`${face.label} view`}
              onClick={() => onLookFrom(face.from)}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="view-cube-home" title="Isometric view" aria-label="Isometric view" onClick={onIsometric}>
        <Home size={14} />
      </button>
    </fieldset>
  );
}

const TRIAD_COLOURS = ["#e03131", "#2f9e44", "#1c7ed6"];
const TRIAD_NAMES = ["x", "y", "z"];

/** Three arrows showing where the global axes point. */
export function AxisTriad({ subscribe }: { subscribe: CameraSubscribe | null }) {
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const labels = useRef<(SVGTextElement | null)[]>([]);
  const groups = useRef<(SVGGElement | null)[]>([]);
  useEffect(() => {
    if (subscribe === null) return;
    return subscribe((basis) => {
      const axes = axesOnScreen(basis);
      axes.forEach(({ x, y }, k) => {
        lines.current[k]?.setAttribute("x2", String(28 * x));
        lines.current[k]?.setAttribute("y2", String(28 * y));
        labels.current[k]?.setAttribute("x", String(36 * x));
        labels.current[k]?.setAttribute("y", String(36 * y + 4));
      });
      // The axis nearest the viewer is drawn last, on top.
      const order = [0, 1, 2].sort((a, b) => (axes[a]?.depth ?? 0) - (axes[b]?.depth ?? 0));
      const parent = groups.current[0]?.parentNode;
      for (const k of order) {
        const group = groups.current[k];
        if (parent && group) parent.appendChild(group);
      }
    });
  }, [subscribe]);
  return (
    <svg className="axis-triad" viewBox="-46 -46 92 92" aria-hidden="true">
      <circle r="3" className="axis-triad-origin" />
      {TRIAD_NAMES.map((name, k) => (
        <g
          key={name}
          ref={(element) => {
            groups.current[k] = element;
          }}
        >
          <line
            ref={(element) => {
              lines.current[k] = element;
            }}
            x1={0}
            y1={0}
            x2={0}
            y2={0}
            stroke={TRIAD_COLOURS[k]}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <text
            ref={(element) => {
              labels.current[k] = element;
            }}
            fill={TRIAD_COLOURS[k]}
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
          >
            {name}
          </text>
        </g>
      ))}
    </svg>
  );
}
