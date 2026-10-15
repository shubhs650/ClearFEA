// SPDX-License-Identifier: AGPL-3.0-or-later
// The three.js scene behind the viewer: renders a display mesh, orbits and zooms with the
// mouse, and reports which face is under the pointer and which face was clicked. React state
// (selection, hover text) lives in Viewer.tsx; this class only draws what it is told.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type DisplayFace, type DisplayMesh, faceAtTriangle, faceOutlines, triangleEdges } from "./displayMesh";

const COLOURS = {
  background: new Color("#e9ecef"),
  face: new Color("#b8c0c8"),
  hover: new Color("#a5d8ff"),
  selected: new Color("#1c7ed6"),
  selectedHover: new Color("#4dabf7"),
  outline: new Color("#495057"),
  elementEdge: new Color("#343a40"),
};

/** Lines drawn over the faces: the face outlines of a geometry, or every element edge of a mesh. */
export type Edges = "outlines" | "elements";

/** A press that moves less than this many pixels before release is a click, not an orbit. */
const CLICK_SLOP_PX = 4;

export type ModelViewEvents = {
  /** The face under the pointer changed; null when the pointer is off the model. */
  onHover: (faceTag: number | null) => void;
  /** A face was clicked (not dragged). */
  onPick: (faceTag: number) => void;
};

export class ModelView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 0.001, 10);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly resize: ResizeObserver;
  private mesh: DisplayMesh | null = null;
  private facesByTag = new Map<number, DisplayFace>();
  private surface: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private outlines: LineSegments | null = null;
  private hovered: number | null = null;
  private selected = new Set<number>();
  private pressedAt: { x: number; y: number } | null = null;
  private frame = 0;

  /** Throws if the browser cannot create a WebGL context. */
  constructor(
    private readonly container: HTMLElement,
    private readonly events: ModelViewEvents,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLOURS.background);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new AmbientLight(0xffffff, 1.2));
    // The key light follows the camera, so the side the user looks at is always lit.
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(0.5, 1, 1);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", () => this.requestRender());

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerleave", this.pointerLeave);
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointerup", this.pointerUp);

    this.resize = new ResizeObserver(() => this.fitCanvas());
    this.resize.observe(container);
    this.fitCanvas();
  }

  /**
   * Replaces the model. The camera is framed on it unless `keepView` is set, which a switch
   * between a geometry and its mesh uses so the user keeps looking where they were.
   */
  setMesh(mesh: DisplayMesh, edges: Edges = "outlines", keepView = false): void {
    this.clearModel();
    this.mesh = mesh;
    this.facesByTag = new Map(mesh.faces.map((face) => [face.tag, face]));

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.surface = new Mesh(
      geometry,
      new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.75,
        metalness: 0.05,
        // Push the faces back a little so the outlines draw cleanly on top.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    this.scene.add(this.surface);

    const lines = new BufferGeometry();
    const segments = edges === "elements" ? triangleEdges(mesh) : faceOutlines(mesh);
    lines.setAttribute("position", new BufferAttribute(segments, 3));
    const colour = edges === "elements" ? COLOURS.elementEdge : COLOURS.outline;
    this.outlines = new LineSegments(lines, new LineBasicMaterial({ color: colour }));
    this.scene.add(this.outlines);

    this.paintAll();
    if (keepView) this.requestRender();
    else this.resetView();
  }

  /** Points the camera at the whole model from an isometric direction. */
  resetView(): void {
    const sphere = this.surface?.geometry.boundingSphere;
    if (!sphere) return;
    const radius = Math.max(sphere.radius, 1e-6);
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(fov / 2)) * 1.15;
    const direction = new Vector3(1, 0.8, 1.2).normalize();
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.minDistance = radius / 50;
    this.controls.maxDistance = distance * 20;
    this.controls.update();
    this.requestRender();
  }

  setSelection(tags: ReadonlySet<number>): void {
    const changed = new Set([...this.selected, ...tags]);
    this.selected = new Set(tags);
    for (const tag of changed) this.paintFace(tag);
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clearModel(): void {
    for (const object of [this.surface, this.outlines]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      const material = object.material;
      if (!Array.isArray(material)) material.dispose();
    }
    this.surface = null;
    this.outlines = null;
    this.mesh = null;
    this.facesByTag = new Map();
    this.hovered = null;
  }

  private fitCanvas(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  }

  private colourOf(tag: number): Color {
    const selected = this.selected.has(tag);
    if (tag === this.hovered) return selected ? COLOURS.selectedHover : COLOURS.hover;
    return selected ? COLOURS.selected : COLOURS.face;
  }

  private paintAll(): void {
    for (const tag of this.facesByTag.keys()) this.paintFace(tag);
  }

  private paintFace(tag: number): void {
    const face = this.facesByTag.get(tag);
    const attribute = this.surface?.geometry.getAttribute("color");
    if (!face || !(attribute instanceof BufferAttribute)) return;
    const { r, g, b } = this.colourOf(tag);
    const colours = attribute.array as Float32Array;
    for (let v = face.firstVertex; v < face.firstVertex + face.vertexCount; v++) {
      colours[v * 3] = r;
      colours[v * 3 + 1] = g;
      colours[v * 3 + 2] = b;
    }
    attribute.needsUpdate = true;
  }

  /** The face tag under a pointer position, or null. */
  private faceAt(event: PointerEvent): number | null {
    if (!this.surface || !this.mesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.surface, false)[0];
    if (hit?.faceIndex == null) return null;
    return faceAtTriangle(this.mesh, hit.faceIndex)?.tag ?? null;
  }

  private setHovered(tag: number | null): void {
    if (tag === this.hovered) return;
    const previous = this.hovered;
    this.hovered = tag;
    if (previous !== null) this.paintFace(previous);
    if (tag !== null) this.paintFace(tag);
    this.requestRender();
    this.events.onHover(tag);
  }

  private readonly pointerMove = (event: PointerEvent) => {
    // While a button is held the user is orbiting or panning; leave the hover alone.
    if (event.buttons !== 0) return;
    this.setHovered(this.faceAt(event));
  };

  private readonly pointerLeave = () => this.setHovered(null);

  private readonly pointerDown = (event: PointerEvent) => {
    this.pressedAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };

  private readonly pointerUp = (event: PointerEvent) => {
    const start = this.pressedAt;
    this.pressedAt = null;
    if (!start || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
    const tag = this.faceAt(event);
    this.setHovered(tag);
    if (tag !== null) this.events.onPick(tag);
  };
}
