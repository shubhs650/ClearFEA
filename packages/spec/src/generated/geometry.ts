// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/geometry.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/geometry.schema.json";
import { validator } from "../validate";

/**
 * A length unit symbol from packages/spec/units.json.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "LengthUnit".
 */
export type LengthUnit = string;
/**
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "Vector3".
 */
export type Vector3 = [number, number, number];
/**
 * xmin, ymin, zmin, xmax, ymax, zmax in metres.
 *
 * @minItems 6
 * @maxItems 6
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "BoundingBox".
 */
export type BoundingBox = [number, number, number, number, number, number];
/**
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "FaceType".
 */
export type FaceType = "plane" | "cylinder" | "other";
/**
 * importing: an import job is queued or running. needs_unit: the file declares no usable unit and the user must choose one. unconfirmed: a unit was detected and awaits the user's confirmation. ready: the unit is confirmed and topology.json is at that scale. failed: the import failed; problem says why.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "GeometryStatus".
 */
export type GeometryStatus = "importing" | "needs_unit" | "unconfirmed" | "ready" | "failed";

/**
 * Uploaded STEP geometry: the topology file the import job writes, the import job's parameters and result, and the wire shapes of /api/geometries (docs/ARCHITECTURE.md sections 3 and 4, ADR-023, ADR-024). Lengths are in metres. Each message is a definition under $defs.
 */
export interface Geometry {
  [k: string]: unknown;
}
/**
 * What the import job read about the file's length unit. Factors are metres per file unit.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "UnitReading".
 */
export interface UnitReading {
  /**
   * The unit as the file writes it, for example SI_UNIT(.MILLI.,.METRE.) or 'INCH'; null when it declares none.
   */
  declared: string | null;
  /**
   * The declared unit as a units.json symbol; null when the file declares none, several, an unsupported one, or one whose factor disagrees with the table. The user must then choose one.
   */
  detectedUnit: LengthUnit | null;
  /**
   * Why there is no detected unit, in plain language; null when there is one.
   */
  problem: string | null;
  /**
   * Metres per file coordinate that OpenCASCADE applies when importing the file as it is (ADR-024).
   */
  readingFactor: number;
}
/**
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "TopologyBody".
 */
export interface TopologyBody {
  tag: number;
  /**
   * Cubic metres.
   */
  volume: number;
  faces: number[];
}
/**
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "TopologyFace".
 */
export interface TopologyFace {
  tag: number;
  type: FaceType;
  /**
   * Gmsh's own surface type name, for example Plane or BSpline surface.
   */
  gmshType: string;
  /**
   * Square metres.
   */
  area: number;
  centroid: Vector3;
  bbox: BoundingBox;
  bodies: number[];
}
/**
 * topology.json: the reference for face identity (ARCHITECTURE.md section 3). Written by the import job in metres, at the geometry's confirmed scale once the unit is confirmed.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "Topology".
 */
export interface Topology {
  version: 1;
  /**
   * Diagonal of the model's bounding box, in metres.
   */
  size: number;
  bbox: BoundingBox;
  unit: UnitReading;
  /**
   * Geometry.OCCScaling the file was imported with: 1, or the confirmed unit's factor divided by the reading factor.
   */
  scaling: number;
  /**
   * Versions that produced the tags. Tags are only stable for the same file and the same versions.
   */
  software: {
    gmsh: string;
    occt: string;
  };
  bodies: TopologyBody[];
  faces: TopologyFace[];
}
/**
 * Parameters of an import job. confirmedUnit is null on the first import, which reads the file as it is.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "ImportParams".
 */
export interface ImportParams {
  confirmedUnit: LengthUnit | null;
}
/**
 * Result summary of a succeeded import job.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "ImportResult".
 */
export interface ImportResult {
  unit: UnitReading;
  scaling: number;
  bodies: number;
  faces: number;
  size: number;
  bbox: BoundingBox;
  displayTriangles: number;
}
/**
 * A geometry as its owner sees it. Lengths in metres; the browser converts for display.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "GeometryView".
 */
export interface GeometryView {
  id: string;
  /**
   * The uploaded file's name.
   */
  name: string;
  sizeBytes: number;
  status: GeometryStatus;
  /**
   * Why the import failed, in plain language.
   */
  problem: string | null;
  declaredUnit: string | null;
  detectedUnit: LengthUnit | null;
  unitProblem: string | null;
  confirmedUnit: LengthUnit | null;
  bodyCount: number | null;
  faceCount: number | null;
  /**
   * Bounding box diagonal in metres at the current scale.
   */
  size: number | null;
  bbox: BoundingBox | null;
  createdAt: string;
}
/**
 * Answer to POST /api/geometries (HTTP 201), GET /api/geometries/{id} and POST /api/geometries/{id}/unit.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "GeometryResponse".
 */
export interface GeometryResponse {
  geometry: GeometryView;
}
/**
 * Answer to GET /api/geometries: the signed-in user's geometries, newest first.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "GeometryListResponse".
 */
export interface GeometryListResponse {
  geometries: GeometryView[];
}
/**
 * Body of POST /api/geometries/{id}/unit: the length unit the file is really in.
 *
 * This interface was referenced by `Geometry`'s JSON-Schema
 * via the `definition` "ConfirmUnitRequest".
 */
export interface ConfirmUnitRequest {
  unit: LengthUnit;
}

export const validateLengthUnit = validator<LengthUnit>(schema, "LengthUnit");
export const validateVector3 = validator<Vector3>(schema, "Vector3");
export const validateBoundingBox = validator<BoundingBox>(schema, "BoundingBox");
export const FaceTypeValues = ["plane", "cylinder", "other"] as const satisfies readonly FaceType[];
export const validateFaceType = validator<FaceType>(schema, "FaceType");
export const validateUnitReading = validator<UnitReading>(schema, "UnitReading");
export const validateTopologyBody = validator<TopologyBody>(schema, "TopologyBody");
export const validateTopologyFace = validator<TopologyFace>(schema, "TopologyFace");
export const validateTopology = validator<Topology>(schema, "Topology");
export const validateImportParams = validator<ImportParams>(schema, "ImportParams");
export const validateImportResult = validator<ImportResult>(schema, "ImportResult");
export const GeometryStatusValues = ["importing", "needs_unit", "unconfirmed", "ready", "failed"] as const satisfies readonly GeometryStatus[];
export const validateGeometryStatus = validator<GeometryStatus>(schema, "GeometryStatus");
export const validateGeometryView = validator<GeometryView>(schema, "GeometryView");
export const validateGeometryResponse = validator<GeometryResponse>(schema, "GeometryResponse");
export const validateGeometryListResponse = validator<GeometryListResponse>(schema, "GeometryListResponse");
export const validateConfirmUnitRequest = validator<ConfirmUnitRequest>(schema, "ConfirmUnitRequest");
