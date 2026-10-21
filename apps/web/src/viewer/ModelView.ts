// SPDX-License-Identifier: AGPL-3.0-or-later
// The three.js scene behind the viewer: renders a display mesh, orbits and zooms with the
// mouse, and reports which face is under the pointer and which face was clicked. React state
// (selection, hover text) lives in Viewer.tsx; this class only draws what it is told. Given
// band coordinates per vertex (M1.9), it colours the model in result bands instead of by face.
// Given the geometry's edges (M2.8), it draws them and picks edges instead of faces. While it
// shows results, a click probes the surface vertex nearest the pointer, and labelled markers
// (min/max and probes, M3.3) are drawn as an HTML layer over the canvas at their vertices.
// Given a cut plane (M3.4, ADR-053), it hides the model on the plane's far side and draws the
// section there. The cut is made on the undeformed shape, so the model is clipped by each
// point's undeformed position (a `reference` attribute) and the section meets it exactly on
// the deformed shape too. Faces can be hidden (M3.6, to hide bodies): they are not drawn,
// picked or probed, and the camera can be read and set to restore a saved view. Given a swing
// per vertex (M6.2, a mode shape drawn deformed), it animates the model, its outlines and the
// section between the undeformed shape and the shape drawn, through the opposite one, in the
// vertex shader, so a frame moves nothing on the CPU. For report figures (M7.2, ADR-011) it can
// draw arrows (a load's direction), frame the model from a chosen direction and hand over the
// picture with where its markers and axes fall, to be finished on a 2D canvas. The interactive
// viewer (UI redesign, ADR-094) also draws on a transparent canvas over a gradient, tells
// listeners where the camera points (the view cube and axis triad), offers display styles, and
// with a cut plane fills the cut with a cap and outlines the plane, so a geometry or mesh can be
// sectioned before it is solved.

import {
  AmbientLight,
  BackSide,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  LineLoop,
  LineBasicMaterial,
  LineSegments,
  Group,
  Mesh,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { type DisplayFace, type DisplayMesh, faceAtTriangle, faceOutlines, triangleEdges } from "./displayMesh";
import { type EdgePolyline, type EdgeSegments, edgeSegments, nearestEdge } from "./edges";
import { BAND_COLOURS, nearestCorner } from "./resultFields";
import type { Plane } from "./section";

/** An arrow drawn over the model (M7.2): from `origin` along `direction`, `length` long, in metres. */
export type Arrow = { origin: [number, number, number]; direction: [number, number, number]; length: number };

/** What the scene looks like now, for a report figure (M7.2): the picture, where each marker
 * falls on it, and which way the global x, y and z axes point on screen (y down). */
export type Snapshot = {
  image: HTMLCanvasElement;
  markers: { marker: Marker; x: number; y: number }[];
  axes: [number, number][];
};

/** Options for a ModelView that draws report figures rather than the interactive viewer. */
export type ModelViewOptions = { pixelRatio?: number; background?: string };

/** Where the camera is and what it looks at, in metres (a saved view's camera, M3.6). */
export type CameraView = { position: [number, number, number]; target: [number, number, number] };

const COLOURS = {
  background: new Color("#e9ecef"),
  face: new Color("#b8c0c8"),
  hover: new Color("#a5d8ff"),
  selected: new Color("#1c7ed6"),
  selectedHover: new Color("#4dabf7"),
  outline: new Color("#495057"),
  elementEdge: new Color("#343a40"),
  edge: new Color("#212529"),
  arrow: new Color("#c92a2a"),
  cap: new Color("#d9822b"),
  plane: new Color("#2563eb"),
};

/** How the interactive viewer draws the model (UI redesign): shaded with its outlines or element
 * edges, shaded alone, see-through, or its lines alone with hidden lines removed. */
export type DisplayStyle = "shadedEdges" | "shaded" | "transparent" | "hiddenLines";

/** Which way the camera looks, as its right, up and back unit vectors in world axes. */
export type CameraBasis = { right: [number, number, number]; up: [number, number, number]; back: [number, number, number] };

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

/** The direction the camera looks from by default. */
export const ISOMETRIC: readonly [number, number, number] = [1, 0.8, 1.2];

/** A press that moves less than this many pixels before release is a click, not an orbit. */
const CLICK_SLOP_PX = 4;

/** How near the pointer an edge must pass on screen to be hovered or picked. */
const EDGE_SLOP_PX = 10;

/**
 * Widths of the geometry's edges on screen while they are picked (M9, ADR-105): WebGL draws plain
 * lines 1 px wide, too thin to see which edge is picked, so edges are wide lines, and the
 * hovered and selected ones wider still.
 */
const EDGE_WIDTH_PX = 2.5;
const PICKED_EDGE_WIDTH_PX = 6;

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

/** A labelled point on the model: the smallest or largest value, or a probe (M3.3). The vertex
 * is the model's, or with `onSection` the cut plane section's (M3.4). */
export type Marker = { vertex: number; kind: "min" | "max" | "probe"; text: string; onSection?: boolean };

/** What a cut plane shows (M3.4): the plane, on the undeformed shape, and the section drawn
 * where it cuts the model, coloured like the model by band coordinates. */
export type Cut = {
  plane: Plane;
  /** x, y, z per section vertex, on the shape drawn (deformed or not). */
  positions: Float32Array;
  /** Three section vertex indices per triangle, counter-clockwise seen from the cut-away side. */
  indices: Uint32Array;
  coordinates: Float32Array;
  /** While the model swings (M6.2): how far each section vertex moves, as for setSwing. */
  swing?: Float32Array;
};

/** How long one swing of an animated mode shape takes on screen, in milliseconds (M6.2). */
const SWING_PERIOD_MS = 1600;

/** Adds `transformed += swing * swingPhase` to a material's vertex shader: the vertex moves
 * along its swing attribute by the shared phase (0 while nothing swings). */
function swingVertices(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 swing;\nuniform float swingPhase;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += swing * swingPhase;");
}

/** Texture coordinates for band coordinates: u along the band texture, v in its middle. */
function bandUv(coordinates: Float32Array): Float32Array {
  const uv = new Float32Array(coordinates.length * 2);
  coordinates.forEach((u, v) => {
    uv[v * 2] = u;
    uv[v * 2 + 1] = 0.5;
  });
  return uv;
}

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
  private edgeLines: LineSegments2 | null = null;
  /** The hovered and selected edges, drawn again wider over edgeLines. */
  private pickedEdgeLines: LineSegments2 | null = null;
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
  /** Undeformed position of each model vertex, which the cut plane clips by. */
  private reference: Float32Array | null = null;
  private section: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private plane: Plane | null = null;
  /** Faces not drawn (M3.6); kept across setMesh, since every model of a geometry uses its tags. */
  private hiddenFaces: ReadonlySet<number> = new Set();
  /** Which outlines setMesh drew, so they can be redrawn without the hidden faces. */
  private edgesKind: Edges = "outlines";
  /** Shared by every clipped material's shader; cutOn is 0 while there is no cut. */
  private readonly clip = {
    cutNormal: { value: new Vector3() },
    cutOffset: { value: 0 },
    cutOn: { value: 0 },
    /** sin(ωt) − 1 while the model swings (M6.2), else 0: the drawn shape at the start. */
    swingPhase: { value: 0 },
  };
  /** How far each model vertex moves from the shape drawn to the undeformed one while the
   * model swings, or null (M6.2). */
  private swing: Float32Array | null = null;
  private swingFrame = 0;
  private arrows: Group[] = [];
  /** Whether this is the interactive viewer rather than a report figure's scene. */
  private readonly interactive: boolean;
  private style: DisplayStyle = "shadedEdges";
  /** Back faces drawn in one colour where the cut plane opens the model (interactive only). */
  private cap: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  /** The cut plane's outline and faint fill (interactive only). */
  private planeShown: Group | null = null;
  private readonly cameraListeners = new Set<(basis: CameraBasis) => void>();

  /** Throws if the browser cannot create a WebGL context. */
  constructor(
    private readonly container: HTMLElement,
    private readonly events: ModelViewEvents,
    options: ModelViewOptions = {},
  ) {
    this.interactive = options.background === undefined;
    // The interactive viewer draws over the gradient behind its canvas; a figure on its colour.
    this.renderer = new WebGLRenderer({ antialias: true, alpha: this.interactive, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(options.pixelRatio ?? window.devicePixelRatio);
    if (this.interactive) this.renderer.setClearColor(COLOURS.background, 0);
    else this.renderer.setClearColor(new Color(options.background));
    container.appendChild(this.renderer.domElement);
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "viewer-markers";
    container.appendChild(this.markerLayer);

    if (this.interactive) {
      // Sky and ground light give the interactive model some depth; figures keep the flat light.
      this.scene.add(new AmbientLight(0xffffff, 0.8));
      this.scene.add(new HemisphereLight(0xffffff, 0x8a94a6, 0.9));
    } else {
      this.scene.add(new AmbientLight(0xffffff, 1.2));
    }
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
   * model is coloured in result bands and clicks no longer pick faces. `reference` is each
   * vertex's undeformed position when the mesh is drawn deformed; a cut plane clips by it.
   */
  setMesh(
    mesh: DisplayMesh,
    edges: Edges = "outlines",
    keepView = false,
    bandCoordinates?: Float32Array,
    reference: Float32Array = mesh.positions,
  ): void {
    this.clearModel();
    this.mesh = mesh;
    this.reference = reference;
    this.stopSwing();
    this.facesByTag = new Map(mesh.faces.map((face) => [face.tag, face]));
    this.picking = bandCoordinates === undefined;

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("reference", new BufferAttribute(reference, 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    geometry.setAttribute("shown", new BufferAttribute(this.shownOf(mesh), 1));
    geometry.setAttribute("swing", new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    if (bandCoordinates !== undefined) {
      geometry.setAttribute("uv", new BufferAttribute(bandUv(bandCoordinates), 2));
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
    this.clipped(this.surface.material, true, true);
    this.scene.add(this.surface);

    this.edgesKind = edges;
    this.drawOutlines();
    this.applyStyle();
    this.paintAll();
    if (keepView) this.requestRender();
    else this.resetView();
  }

  /** Points the camera at the whole model, or the faces left shown, from an isometric direction
   * or, for a report figure (M7.2), from the direction given and with the margin given (the
   * distance as a multiple of the one at which the model's bounding sphere just fits). */
  resetView(from: readonly [number, number, number] = ISOMETRIC, margin = 1.15): void {
    const sphere = this.shownSphere();
    if (!sphere) return;
    const radius = Math.max(sphere.radius, 1e-6);
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(fov / 2)) * margin;
    const direction = new Vector3(...from).normalize();
    // Looking straight down y, the camera's up (y) would be undefined: lean it a little.
    if (Math.abs(direction.y) > 0.999) direction.set(0.02, Math.sign(direction.y), 0.02).normalize();
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

  /** Frames the whole model, or the faces left shown, keeping the direction the camera looks from. */
  fitView(): void {
    const from = this.camera.position.clone().sub(this.controls.target);
    if (from.lengthSq() === 0) this.resetView();
    else this.resetView([from.x, from.y, from.z]);
  }

  /** Calls `listener` with the camera's direction after every redraw, and once now; returns a
   * function that stops it (the view cube and axis triad follow the camera this way). */
  onCamera(listener: (basis: CameraBasis) => void): () => void {
    this.cameraListeners.add(listener);
    listener(this.basis());
    return () => this.cameraListeners.delete(listener);
  }

  /** Draws the model shaded with its lines, shaded alone, see-through, or as lines alone. */
  setDisplayStyle(style: DisplayStyle): void {
    this.style = style;
    this.applyStyle();
    this.requestRender();
  }

  /** Where the camera is now. */
  cameraView(): CameraView {
    const { x, y, z } = this.camera.position;
    const t = this.controls.target;
    return { position: [x, y, z], target: [t.x, t.y, t.z] };
  }

  /** Moves the camera to a saved place, keeping the zoom limits sensible for the model. */
  setCamera(view: CameraView): void {
    this.camera.position.set(...view.position);
    this.controls.target.set(...view.target);
    const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-6);
    const radius = this.surface?.geometry.boundingSphere?.radius ?? distance;
    this.camera.near = Math.min(distance, radius) / 100;
    this.camera.far = (distance + radius) * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.min(radius / 50, distance);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance * 2);
    this.controls.update();
    this.requestRender();
  }

  /**
   * Hides faces by tag, or shows them all again with an empty set (M3.6). Hidden faces are not
   * drawn, hovered, picked or probed, and markers on them are hidden. Kept across setMesh.
   */
  setHiddenFaces(tags: ReadonlySet<number>): void {
    this.hiddenFaces = new Set(tags);
    const shown = this.surface?.geometry.getAttribute("shown");
    if (this.mesh && shown instanceof BufferAttribute) {
      shown.copyArray(this.shownOf(this.mesh));
      shown.needsUpdate = true;
      this.drawOutlines();
    }
    if (this.hovered !== null && this.hiddenFaces.has(this.hovered)) this.setHovered(null);
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
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(this.edges.positions);
      this.edgeLines = new LineSegments2(geometry, this.edgeMaterial(EDGE_WIDTH_PX, false));
      this.edgeLines.renderOrder = 1;
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

  /** Recolours the model given to setMesh with new band coordinates, one per vertex. */
  setBands(coordinates: Float32Array): void {
    const uv = this.surface?.geometry.getAttribute("uv");
    if (!(uv instanceof BufferAttribute) || uv.count !== coordinates.length) return;
    uv.copyArray(bandUv(coordinates));
    uv.needsUpdate = true;
    this.requestRender();
  }

  /**
   * Hides the model beyond the cut plane and draws the section, or with null shows the whole
   * model again. setMesh clears it, so call this after it.
   */
  setCut(cut: Cut | null): void {
    this.clearSection();
    this.plane = cut?.plane ?? null;
    this.clip.cutOn.value = cut === null ? 0 : 1;
    if (cut !== null) {
      this.clip.cutNormal.value.set(...cut.plane.normal);
      this.clip.cutOffset.value = cut.plane.offset;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(cut.positions, 3));
      geometry.setAttribute("uv", new BufferAttribute(bandUv(cut.coordinates), 2));
      // Flat: every point of the section faces the cut-away side.
      const normals = new Float32Array(cut.positions.length);
      for (let v = 0; v < normals.length; v += 3) normals.set(cut.plane.normal, v);
      geometry.setAttribute("normal", new BufferAttribute(normals, 3));
      geometry.setAttribute("swing", new BufferAttribute(cut.swing ?? new Float32Array(cut.positions.length), 3));
      geometry.setIndex(new BufferAttribute(cut.indices, 1));
      geometry.computeBoundingSphere();
      this.bands ??= bandTexture();
      const material = new MeshStandardMaterial({
        map: this.bands,
        roughness: 0.75,
        metalness: 0.05,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.clip);
        swingVertices(shader);
      };
      this.section = new Mesh(geometry, material);
      this.scene.add(this.section);
      if (this.interactive) this.drawCap(cut.plane);
    }
    this.requestRender();
  }

  /**
   * Animates the model (M6.2): each vertex swings from the shape setMesh drew, by -2 times
   * `swing` and back, so with the drawn shape deformed by a mode shape and `swing` that same
   * deformation, the model vibrates about its undeformed shape. Null stops it at the drawn
   * shape. setMesh stops it, so call this after it; give the section's swing with setCut.
   * Markers are hidden while it swings, since they mark the drawn shape.
   */
  setSwing(swing: Float32Array | null): void {
    const attribute = this.surface?.geometry.getAttribute("swing");
    if (swing !== null && (!(attribute instanceof BufferAttribute) || attribute.array.length !== swing.length)) return;
    this.stopSwing();
    this.swing = swing;
    if (attribute instanceof BufferAttribute) {
      (attribute.array as Float32Array).set(swing ?? new Float32Array(attribute.array.length));
      attribute.needsUpdate = true;
    }
    this.drawOutlines();
    if (swing === null) {
      this.requestRender();
      return;
    }
    this.markerLayer.hidden = true;
    const start = performance.now();
    const tick = (now: number) => {
      this.clip.swingPhase.value = Math.sin((2 * Math.PI * (now - start)) / SWING_PERIOD_MS) - 1;
      this.renderer.render(this.scene, this.camera);
      this.swingFrame = requestAnimationFrame(tick);
    };
    this.swingFrame = requestAnimationFrame(tick);
  }

  /** Draws arrows over the model, always in front of it, replacing any drawn before (M7.2).
   * setMesh clears them, so call this after it. */
  setArrows(arrows: readonly Arrow[]): void {
    this.clearArrows();
    this.arrows = arrows.map(({ origin, direction, length }) => {
      // A solid shaft and head, so the arrow reads at print size (a WebGL line is one pixel wide).
      const head = length * 0.25;
      const material = new MeshBasicMaterial({ color: COLOURS.arrow, depthTest: false, transparent: true });
      const shaft = new Mesh(new CylinderGeometry(length * 0.025, length * 0.025, length - head, 12), material);
      shaft.position.y = (length - head) / 2;
      const tip = new Mesh(new ConeGeometry(length * 0.08, head, 16), material);
      tip.position.y = length - head / 2;
      const arrow = new Group();
      arrow.add(shaft, tip);
      // The parts are built along +y; turn them onto the direction.
      arrow.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...direction).normalize()));
      arrow.position.set(...origin);
      arrow.traverse((part) => {
        part.renderOrder = 10;
      });
      this.scene.add(arrow);
      return arrow;
    });
    this.requestRender();
  }

  /**
   * Draws the scene now and returns a copy of it with where the markers fall and which way the
   * axes point on screen (M7.2): what a report figure is finished from. Taken in the same task as
   * the drawing, so the WebGL buffer still holds the picture.
   */
  snapshot(): Snapshot {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const image = document.createElement("canvas");
    image.width = source.width;
    image.height = source.height;
    image.getContext("2d")?.drawImage(source, 0, 0);
    const ratio = this.renderer.getPixelRatio();
    const markers = this.markers.flatMap(({ marker }) => {
      const at = this.markerAt(marker);
      return at === null ? [] : [{ marker, x: at.x * ratio, y: at.y * ratio }];
    });
    const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((axis): [number, number] => {
      const seen = axis.transformDirection(this.camera.matrixWorldInverse);
      return [seen.x, -seen.y];
    });
    return { image, markers, axes };
  }

  dispose(): void {
    this.stopSwing();
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.bands?.dispose();
    this.cameraListeners.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.markerLayer.remove();
  }

  /** A wide-line material `width` pixels wide, in the edge colour or the vertices' own. */
  private edgeMaterial(width: number, vertexColors: boolean): LineMaterial {
    const material = new LineMaterial({ linewidth: width, vertexColors, color: vertexColors ? 0xffffff : COLOURS.edge });
    const size = this.renderer.getSize(new Vector2());
    material.resolution.set(size.x, size.y);
    return material;
  }

  private clearPickedEdges(): void {
    if (this.pickedEdgeLines) {
      this.scene.remove(this.pickedEdgeLines);
      this.pickedEdgeLines.geometry.dispose();
      this.pickedEdgeLines.material.dispose();
    }
    this.pickedEdgeLines = null;
  }

  private clearEdges(): void {
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      this.edgeLines.material.dispose();
    }
    this.clearPickedEdges();
    this.edgeLines = null;
    this.edges = null;
    this.hoveredEdge = null;
    this.mode = "faces";
  }

  /** (Re)draws the hovered and selected edges wide, in their colours, over the others. */
  private paintEdges(): void {
    this.clearPickedEdges();
    if (!this.edges) return;
    const positions: number[] = [];
    const colours: number[] = [];
    for (const run of this.edges.runs) {
      const selected = this.selectedEdges.has(run.tag);
      if (!selected && run.tag !== this.hoveredEdge) continue;
      const colour =
        run.tag === this.hoveredEdge ? (selected ? COLOURS.selectedHover : COLOURS.hover) : COLOURS.selected;
      for (let p = run.firstPoint; p < run.firstPoint + run.pointCount; p++) {
        positions.push(...this.edges.positions.subarray(p * 3, p * 3 + 3));
        colours.push(colour.r, colour.g, colour.b);
      }
    }
    if (positions.length === 0) return;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colours);
    this.pickedEdgeLines = new LineSegments2(geometry, this.edgeMaterial(PICKED_EDGE_WIDTH_PX, true));
    this.pickedEdgeLines.renderOrder = 2;
    this.scene.add(this.pickedEdgeLines);
  }

  /**
   * Makes a material discard what lies beyond the cut plane, judged by the undeformed position
   * in the geometry's `reference` attribute, and with `hiding` what its `shown` attribute marks
   * 0 (a hidden face's vertices).
   */
  private clipped<T extends Material>(material: T, hiding = false, swinging = false): T {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.clip);
      // With `swinging`, the geometry has a swing attribute that setSwing animates (M6.2).
      if (swinging) swingVertices(shader);
      const declare = hiding ? "\nattribute float shown;\nvarying float vShown;" : "";
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nattribute vec3 reference;\nvarying vec3 vReference;${declare}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\nvReference = reference;${hiding ? "\nvShown = shown;" : ""}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\nuniform vec3 cutNormal;\nuniform float cutOffset;\nuniform float cutOn;\nvarying vec3 vReference;${hiding ? "\nvarying float vShown;" : ""}`,
        )
        .replace(
          "void main() {",
          `void main() {\nif (cutOn > 0.5 && dot(cutNormal, vReference) > cutOffset) discard;${hiding ? "\nif (vShown < 0.5) discard;" : ""}`,
        );
    };
    return material;
  }

  /** 1 for each vertex of a shown face, 0 for a hidden face's. */
  private shownOf(mesh: DisplayMesh): Float32Array {
    const shown = new Float32Array(mesh.positions.length / 3).fill(1);
    for (const face of mesh.faces) {
      if (this.hiddenFaces.has(face.tag)) shown.fill(0, face.firstVertex, face.firstVertex + face.vertexCount);
    }
    return shown;
  }

  /** Whether a vertex of the model belongs to a hidden face. */
  private vertexHidden(vertex: number): boolean {
    const shown = this.surface?.geometry.getAttribute("shown");
    return shown instanceof BufferAttribute && shown.getX(vertex) < 0.5;
  }

  /** (Re)draws the lines over the shown faces: their outlines, or every element edge. */
  private drawOutlines(): void {
    if (this.outlines) {
      this.scene.remove(this.outlines);
      this.outlines.geometry.dispose();
      const material = this.outlines.material;
      if (!Array.isArray(material)) material.dispose();
      this.outlines = null;
    }
    const mesh = this.mesh;
    if (!mesh) return;
    const faces = mesh.faces.filter((face) => !this.hiddenFaces.has(face.tag));
    const reference = this.reference ?? mesh.positions;
    const lines = new BufferGeometry();
    const segmentsOf = this.edgesKind === "elements" ? triangleEdges : faceOutlines;
    lines.setAttribute("position", new BufferAttribute(segmentsOf({ ...mesh, faces }), 3));
    lines.setAttribute("reference", new BufferAttribute(segmentsOf({ ...mesh, faces, positions: reference }), 3));
    const swing = this.swing ?? new Float32Array(mesh.positions.length);
    lines.setAttribute("swing", new BufferAttribute(segmentsOf({ ...mesh, faces, positions: swing }), 3));
    const colour = this.edgesKind === "elements" ? COLOURS.elementEdge : COLOURS.outline;
    this.outlines = new LineSegments(lines, this.clipped(new LineBasicMaterial({ color: colour }), false, true));
    this.scene.add(this.outlines);
    this.outlines.visible = this.style !== "shaded";
  }

  /** The sphere around the shown faces' vertices (the whole model when none is hidden). */
  private shownSphere(): Sphere | null {
    const geometry = this.surface?.geometry;
    const whole = geometry?.boundingSphere ?? null;
    if (!geometry || this.hiddenFaces.size === 0) return whole;
    const positions = geometry.getAttribute("position");
    const box = new Box3();
    const point = new Vector3();
    for (let v = 0; v < positions.count; v++) {
      if (!this.vertexHidden(v)) box.expandByPoint(point.fromBufferAttribute(positions, v));
    }
    if (box.isEmpty()) return whole;
    const sphere = box.getBoundingSphere(new Sphere());
    return sphere;
  }

  /** Whether an undeformed point is cut away by the cut plane. */
  private cutAway(x: number, y: number, z: number): boolean {
    if (this.plane === null) return false;
    const [nx, ny, nz] = this.plane.normal;
    return nx * x + ny * y + nz * z > this.plane.offset;
  }

  /** Stops the animation at the drawn shape; the swing attributes stay until setMesh. */
  private stopSwing(): void {
    cancelAnimationFrame(this.swingFrame);
    this.swingFrame = 0;
    this.swing = null;
    this.clip.swingPhase.value = 0;
    this.markerLayer.hidden = false;
  }

  private clearSection(): void {
    if (this.section) {
      this.scene.remove(this.section);
      this.section.geometry.dispose();
      this.section.material.dispose();
    }
    this.section = null;
    if (this.cap) {
      // The cap shares the surface's geometry, which setMesh disposes.
      this.scene.remove(this.cap);
      this.cap.material.dispose();
    }
    this.cap = null;
    if (this.planeShown) {
      this.scene.remove(this.planeShown);
      for (const part of this.planeShown.children) {
        if (!(part instanceof Mesh || part instanceof LineLoop)) continue;
        part.geometry.dispose();
        (part.material as Material).dispose();
      }
    }
    this.planeShown = null;
  }

  /**
   * Fills the opening the cut plane makes in the model with the back faces seen through it, in one
   * colour, and outlines the plane: a closed body then reads as solid where it is cut, before
   * the section (results only) is drawn over it.
   */
  private drawCap(plane: Plane): void {
    const surface = this.surface;
    if (!surface) return;
    const material = this.clipped(new MeshBasicMaterial({ color: COLOURS.cap, side: BackSide }), true, true);
    this.cap = new Mesh(surface.geometry, material);
    this.scene.add(this.cap);
    this.applyStyle();
    const sphere = surface.geometry.boundingSphere;
    if (!sphere) return;
    // A square on the plane around the model, a little larger than it.
    const normal = new Vector3(...plane.normal);
    const size = sphere.radius * 1.25;
    const centre = sphere.center.clone().addScaledVector(normal, plane.offset - normal.dot(sphere.center));
    const along = Math.abs(normal.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(normal, along).normalize().multiplyScalar(size);
    const v = new Vector3().crossVectors(normal, u).normalize().multiplyScalar(size);
    const corners = [
      centre.clone().add(u).add(v),
      centre.clone().sub(u).add(v),
      centre.clone().sub(u).sub(v),
      centre.clone().add(u).sub(v),
    ];
    const outline = new BufferGeometry().setFromPoints(corners);
    const fill = new BufferGeometry().setFromPoints(corners);
    fill.setIndex([0, 1, 2, 0, 2, 3]);
    const group = new Group();
    group.add(new LineLoop(outline, new LineBasicMaterial({ color: COLOURS.plane, transparent: true, opacity: 0.6 })));
    group.add(
      new Mesh(
        fill,
        new MeshBasicMaterial({ color: COLOURS.plane, transparent: true, opacity: 0.06, side: DoubleSide, depthWrite: false }),
      ),
    );
    this.planeShown = group;
    this.scene.add(group);
  }

  /** Puts the display style on the surface and its lines. */
  private applyStyle(): void {
    const surface = this.surface;
    if (surface) {
      const material = surface.material;
      const transparent = this.style === "transparent";
      material.transparent = transparent;
      material.opacity = transparent ? 0.35 : 1;
      material.depthWrite = !transparent;
      // Lines alone: the faces still hide the lines behind them, but draw no colour.
      material.colorWrite = this.style !== "hiddenLines";
      material.needsUpdate = true;
    }
    if (this.outlines) this.outlines.visible = this.style !== "shaded";
    // The cap shows the cut as solid; seen through or as lines alone there is nothing solid.
    if (this.cap) this.cap.visible = this.style === "shadedEdges" || this.style === "shaded";
  }

  /** The camera's right, up and back directions in world axes. */
  private basis(): CameraBasis {
    const e = this.camera.matrixWorld.elements;
    return {
      right: [e[0] ?? 1, e[1] ?? 0, e[2] ?? 0],
      up: [e[4] ?? 0, e[5] ?? 1, e[6] ?? 0],
      back: [e[8] ?? 0, e[9] ?? 0, e[10] ?? 1],
    };
  }

  private clearArrows(): void {
    for (const arrow of this.arrows) {
      this.scene.remove(arrow);
      for (const part of arrow.children) {
        if (!(part instanceof Mesh)) continue;
        part.geometry.dispose();
        (part.material as Material).dispose();
      }
    }
    this.arrows = [];
  }

  private clearModel(): void {
    this.clearArrows();
    this.clearEdges();
    this.clearSection();
    this.plane = null;
    this.clip.cutOn.value = 0;
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
    // Wide lines are sized in pixels of the canvas.
    for (const lines of [this.edgeLines, this.pickedEdgeLines]) lines?.material.resolution.set(width, height);
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
      if (this.cameraListeners.size > 0) {
        const basis = this.basis();
        for (const listener of this.cameraListeners) listener(basis);
      }
    });
  }

  /** Moves each marker's element over its vertex as drawn now; hides it behind the camera.
   * A label that would overlap one placed before it moves below or above its dot instead, so
   * the minimum and maximum stay readable where they lie close together. */
  private placeMarkers(): void {
    const placed: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const { marker, element } of this.markers) {
      const at = this.markerAt(marker);
      element.hidden = at === null;
      if (at === null) continue;
      element.style.left = `${at.x}px`;
      element.style.top = `${at.y}px`;
      const label = element.firstElementChild;
      if (!(label instanceof HTMLElement)) continue;
      const width = label.offsetWidth;
      const height = label.offsetHeight;
      const offsets = [-24, 8, -24 - (height + 4), 8 + height + 4];
      let top = offsets[0] ?? -24;
      for (const offset of offsets) {
        const box = { left: at.x + 9, top: at.y + offset, right: at.x + 9 + width, bottom: at.y + offset + height };
        const clash = placed.some(
          (other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom,
        );
        top = offset;
        if (!clash) break;
      }
      label.style.top = `${top}px`;
      placed.push({ left: at.x + 9, top: at.y + top, right: at.x + 9 + width, bottom: at.y + top + height });
    }
  }

  /** Where a marker's vertex is drawn now, in CSS pixels from the top left, or null when it is
   * cut away, on a hidden body or behind the camera. */
  private markerAt(marker: Marker): { x: number; y: number } | null {
    const from = (marker.onSection ? this.section : this.surface)?.geometry.getAttribute("position");
    const r = this.reference;
    // A marker on a part the cut plane or a hidden body hides is hidden with it.
    const away =
      !marker.onSection &&
      ((r !== null &&
        this.cutAway(r[marker.vertex * 3] ?? 0, r[marker.vertex * 3 + 1] ?? 0, r[marker.vertex * 3 + 2] ?? 0)) ||
        this.vertexHidden(marker.vertex));
    if (!from || marker.vertex >= from.count || away) return null;
    const point = new Vector3().fromBufferAttribute(from, marker.vertex).project(this.camera);
    if (point.z > 1) return null;
    return { x: ((point.x + 1) / 2) * this.container.clientWidth, y: ((1 - point.y) / 2) * this.container.clientHeight };
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
    // The first hit on a part the cut plane leaves standing, unless the section is in front.
    const r = this.reference;
    const hit = this.raycaster.intersectObject(this.surface, false).find((h) => {
      if (h.face && this.vertexHidden(h.face.a)) return false;
      if (r === null || this.plane === null || !h.face || !h.barycoord) return true;
      const { a, b, c } = h.face;
      const w = h.barycoord;
      const at = (axis: number) => w.x * (r[a * 3 + axis] ?? 0) + w.y * (r[b * 3 + axis] ?? 0) + w.z * (r[c * 3 + axis] ?? 0);
      return !this.cutAway(at(0), at(1), at(2));
    });
    const section = this.section ? this.raycaster.intersectObject(this.section, false)[0] : undefined;
    if (hit && section && section.distance < hit.distance) return undefined;
    return hit;
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
