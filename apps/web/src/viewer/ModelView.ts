// SPDX-License-Identifier: AGPL-3.0-or-later
// The three.js scene behind the viewer: renders a display mesh, orbits and zooms with the
// mouse, and reports which face is under the pointer and which face was clicked. React state
// (selection, hover text) lives in Viewer.tsx; this class only draws what it is told. Given
// band coordinates per vertex (M1.9), it colours the model in result bands instead of by face.
// Given the geometry's edges (M2.8), it draws them and picks edges instead of faces. While it
// shows results, a click probes the surface vertex nearest the pointer, and labelled markers
// (min/max and probes, M3.3) are drawn as an HTML layer over the canvas at their vertices.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type DisplayFace, type DisplayMesh, faceAtTriangle, faceOutlines, triangleEdges } from "./displayMesh";
import { type EdgePolyline, type EdgeSegments, edgeSegments, nearestEdge } from "./edges";
import { BAND_COLOURS, nearestCorner } from "./resultFields";

const COLOURS = {
  background: new Color("#e9ecef"),
  face: new Color("#b8c0c8"),
  hover: new Color("#a5d8ff"),
  selected: new Color("#1c7ed6"),
  selectedHover: new Color("#4dabf7"),
  outline: new Color("#495057"),
  elementEdge: new Color("#343a40"),
  edge: new Color("#212529"),
};

/** Lines drawn over the faces: the face outlines of a geometry, or every element edge of a mesh. */
export type Edges = "outlines" | "elements";

/** A texture with one texel per result band, sampled without blending so bands stay sharp. */
function bandTexture(): DataTexture {
  const texels = new Uint8Array(BAND_COLOURS.length * 4);
  BAND_COLOURS.forEach((hex, k) => {
    const value = Number.parseInt(hex.slice(1), 16);
    texels.set([(value >> 16) & 255, (value >> 8) & 255, value & 255, 255], k * 4);
  });
  const texture = new DataTexture(texels, BAND_COLOURS.length, 1);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A press that moves less than this many pixels before release is a click, not an orbit. */
const CLICK_SLOP_PX = 4;

/** How near the pointer an edge must pass on screen to be hovered or picked. */
const EDGE_SLOP_PX = 8;

/** What a click picks: faces, or (while edges are shown, M2.8) edges. */
export type PickMode = "faces" | "edges";

export type ModelViewEvents = {
  /** The face (or edge, in edge mode) under the pointer changed; null when there is none. */
  onHover: (tag: number | null) => void;
  /** A face (or edge, in edge mode) was clicked (not dragged). */
  onPick: (tag: number) => void;
  /** While the model shows results, the surface was clicked: the vertex nearest the click. */
  onProbe?: (vertex: number) => void;
};

/** A labelled point on the model: the smallest or largest value, or a probe (M3.3). */
export type Marker = { vertex: number; kind: "min" | "max" | "probe"; text: string };

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
  private edges: EdgeSegments | null = null;
  private edgeLines: LineSegments | null = null;
  private mode: PickMode = "faces";
  private hovered: number | null = null;
  private hoveredEdge: number | null = null;
  private selected = new Set<number>();
  private selectedEdges = new Set<number>();
  private pressedAt: { x: number; y: number } | null = null;
  private frame = 0;
  private bands: DataTexture | null = null;
  /** Whether a click picks a face; off while the model shows results. */
  private picking = true;
  private readonly markerLayer: HTMLDivElement;
  private markers: { marker: Marker; element: HTMLDivElement }[] = [];

  /** Throws if the browser cannot create a WebGL context. */
  constructor(
    private readonly container: HTMLElement,
    private readonly events: ModelViewEvents,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLOURS.background);
    container.appendChild(this.renderer.domElement);
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "viewer-markers";
    container.appendChild(this.markerLayer);

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
   * between a geometry, its mesh and its results uses so the user keeps looking where they were.
   * With `bandCoordinates` (0 for the smallest value to 1 for the largest, one per vertex) the
   * model is coloured in result bands and clicks no longer pick faces.
   */
  setMesh(mesh: DisplayMesh, edges: Edges = "outlines", keepView = false, bandCoordinates?: Float32Array): void {
    this.clearModel();
    this.mesh = mesh;
    this.facesByTag = new Map(mesh.faces.map((face) => [face.tag, face]));
    this.picking = bandCoordinates === undefined;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    if (bandCoordinates !== undefined) {
      const uv = new Float32Array(bandCoordinates.length * 2);
      bandCoordinates.forEach((u, v) => {
        uv[v * 2] = u;
        uv[v * 2 + 1] = 0.5;
      });
      geometry.setAttribute("uv", new BufferAttribute(uv, 2));
      this.bands ??= bandTexture();
    }
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    this.surface = new Mesh(
      geometry,
      new MeshStandardMaterial({
        vertexColors: bandCoordinates === undefined,
        map: bandCoordinates === undefined ? null : this.bands,
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

  /**
   * Draws the geometry's edges over the model and picks edges instead of faces, or with null
   * goes back to picking faces. Call after setMesh, which clears them.
   */
  setEdges(edges: readonly EdgePolyline[] | null): void {
    this.clearEdges();
    this.mode = edges === null ? "faces" : "edges";
    if (edges !== null) {
      this.setHovered(null);
      this.edges = edgeSegments(edges);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(this.edges.positions, 3));
      geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.edges.positions.length), 3));
      this.edgeLines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true }));
      this.scene.add(this.edgeLines);
      this.paintEdges();
    }
    this.requestRender();
  }

  setEdgeSelection(tags: ReadonlySet<number>): void {
    this.selectedEdges = new Set(tags);
    this.paintEdges();
    this.requestRender();
  }

  /**
   * Draws labelled markers at surface vertices of the model last given to setMesh, replacing
   * any drawn before. setMesh clears them, so call this after it.
   */
  setMarkers(markers: readonly Marker[]): void {
    this.markerLayer.replaceChildren();
    this.markers = markers.map((marker) => {
      const element = document.createElement("div");
      element.className = `viewer-marker viewer-marker-${marker.kind}`;
      const label = document.createElement("span");
      label.textContent = marker.text;
      element.appendChild(label);
      this.markerLayer.appendChild(element);
      return { marker, element };
    });
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.bands?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.markerLayer.remove();
  }

  private clearEdges(): void {
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      const material = this.edgeLines.material;
      if (!Array.isArray(material)) material.dispose();
    }
    this.edgeLines = null;
    this.edges = null;
    this.hoveredEdge = null;
    this.mode = "faces";
  }

  private paintEdges(): void {
    const attribute = this.edgeLines?.geometry.getAttribute("color");
    if (!this.edges || !(attribute instanceof BufferAttribute)) return;
    const colours = attribute.array as Float32Array;
    for (const run of this.edges.runs) {
      const selected = this.selectedEdges.has(run.tag);
      const colour =
        run.tag === this.hoveredEdge
          ? selected
            ? COLOURS.selectedHover
            : COLOURS.hover
          : selected
            ? COLOURS.selected
            : COLOURS.edge;
      for (let p = run.firstPoint; p < run.firstPoint + run.pointCount; p++) {
        colours.set([colour.r, colour.g, colour.b], p * 3);
      }
    }
    attribute.needsUpdate = true;
  }

  private clearModel(): void {
    this.clearEdges();
    for (const object of [this.surface, this.outlines]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      const material = object.material;
      if (!Array.isArray(material)) material.dispose();
    }
    this.surface = null;
    this.outlines = null;
    this.markerLayer.replaceChildren();
    this.markers = [];
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
      this.placeMarkers();
    });
  }

  /** Moves each marker's element over its vertex as drawn now; hides it behind the camera. */
  private placeMarkers(): void {
    const positions = this.surface?.geometry.getAttribute("position");
    if (!positions || this.markers.length === 0) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const point = new Vector3();
    for (const { marker, element } of this.markers) {
      point.fromBufferAttribute(positions, marker.vertex).project(this.camera);
      element.hidden = point.z > 1;
      element.style.left = `${((point.x + 1) / 2) * width}px`;
      element.style.top = `${((1 - point.y) / 2) * height}px`;
    }
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

  /** The first hit of the model's surface under a pointer position, if any. */
  private surfaceHit(event: PointerEvent) {
    if (!this.surface) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObject(this.surface, false)[0];
  }

  /** The face tag under a pointer position, or null. */
  private faceAt(event: PointerEvent): number | null {
    if (!this.mesh) return null;
    const hit = this.surfaceHit(event);
    if (hit?.faceIndex == null) return null;
    return faceAtTriangle(this.mesh, hit.faceIndex)?.tag ?? null;
  }

  /** The tag of the visible edge nearest the pointer on screen, or null. */
  private edgeAt(event: PointerEvent): number | null {
    if (!this.edges) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
    // A point is hidden when the surface under the pointer is clearly nearer the camera.
    const surface = this.surfaceHit(event)?.distance ?? Number.POSITIVE_INFINITY;
    const radius = this.surface?.geometry.boundingSphere?.radius ?? 1;
    const point = new Vector3();
    const project = (p: readonly number[]) => {
      point.set(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      const depth = point.distanceTo(this.camera.position);
      point.project(this.camera);
      if (point.z > 1) return null;
      return { x: ((point.x + 1) / 2) * rect.width, y: ((1 - point.y) / 2) * rect.height, depth };
    };
    return nearestEdge(this.edges, pointer, EDGE_SLOP_PX, project, (depth) => depth > surface + radius * 0.01);
  }

  private setHoveredEdge(tag: number | null): void {
    if (tag === this.hoveredEdge) return;
    this.hoveredEdge = tag;
    this.paintEdges();
    this.requestRender();
    this.events.onHover(tag);
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
    if (this.mode === "edges") this.setHoveredEdge(this.edgeAt(event));
    else this.setHovered(this.faceAt(event));
  };

  private readonly pointerLeave = () => {
    if (this.mode === "edges") this.setHoveredEdge(null);
    else this.setHovered(null);
  };

  private readonly pointerDown = (event: PointerEvent) => {
    this.pressedAt = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };

  private readonly pointerUp = (event: PointerEvent) => {
    const start = this.pressedAt;
    this.pressedAt = null;
    if (!start || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
    if (this.mode === "edges") {
      const edge = this.edgeAt(event);
      this.setHoveredEdge(edge);
      if (edge !== null && this.picking) this.events.onPick(edge);
      return;
    }
    if (!this.picking) {
      const vertex = this.vertexAt(event);
      if (vertex !== null) this.events.onProbe?.(vertex);
      return;
    }
    const tag = this.faceAt(event);
    this.setHovered(tag);
    if (tag !== null) this.events.onPick(tag);
  };

  /** The vertex of the drawn surface nearest the point under the pointer, or null. */
  private vertexAt(event: PointerEvent): number | null {
    const hit = this.surfaceHit(event);
    const positions = this.surface?.geometry.getAttribute("position");
    if (!this.mesh || hit?.faceIndex == null || !(positions instanceof BufferAttribute)) return null;
    const { x, y, z } = hit.point;
    return nearestCorner(positions.array as Float32Array, this.mesh.indices, hit.faceIndex, [x, y, z]);
  }
}
