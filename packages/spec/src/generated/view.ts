// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/view.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/view.schema.json";
import { validator } from "../validate";

/**
 * x, y, z in metres, in the geometry's axes.
 *
 * @minItems 3
 * @maxItems 3
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewPoint".
 */
export type ViewPoint = [number, number, number];
/**
 * A quantity the result view can colour the model by (apps/web/src/viewer/resultFields.ts); temperature for a steady-state thermal run (M5.1).
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ResultQuantity".
 */
export type ResultQuantity =
  | "displacement"
  | "vonMises"
  | "principal1"
  | "principal2"
  | "principal3"
  | "stressXX"
  | "stressYY"
  | "stressZZ"
  | "stressXY"
  | "stressYZ"
  | "stressZX"
  | "strainXX"
  | "strainYY"
  | "strainZZ"
  | "strainXY"
  | "strainYZ"
  | "strainZX"
  | "safetyFactor"
  | "temperature";
/**
 * How the result view draws the shape: undeformed, at true scale, or exaggerated to be seen.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "Deformation".
 */
export type Deformation = "undeformed" | "true" | "auto";
/**
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewName".
 */
export type ViewName = string;

/**
 * Saved views of a simulation (M3.6, ADR-055): where the camera is, which bodies are hidden and, for views saved on results, what the result view shows. The report (M7) draws its pictures from them. Lengths are in metres. Each message is a definition under $defs.
 */
export interface View {
  [k: string]: unknown;
}
/**
 * The camera looks from position at target, with the y axis up on screen (the viewer orbits about y). Its field of view is the viewer's own.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewCamera".
 */
export interface ViewCamera {
  position: ViewPoint;
  target: ViewPoint;
}
/**
 * A cut plane across one axis (M3.4): at is where along the model it lies, 0 at the smallest coordinate and 1 at the largest; it cuts away the larger coordinates unless flipped.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewCut".
 */
export interface ViewCut {
  axis: 0 | 1 | 2;
  at: number;
  flipped: boolean;
}
/**
 * What a view saved on results shows. Probes are not kept: they belong to one run's mesh.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewResult".
 */
export interface ViewResult {
  quantity: ResultQuantity;
  deformation: Deformation;
  /**
   * Whether the min and max markers are drawn.
   */
  extremes: boolean;
  cut: ViewCut | null;
}
/**
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewSettings".
 */
export interface ViewSettings {
  camera: ViewCamera;
  /**
   * Tags (topology.json) of the bodies not drawn. At least one body of the geometry stays shown.
   */
  hiddenBodies: number[];
  /**
   * Null for a view saved on the geometry or the mesh.
   */
  result: ViewResult | null;
}
/**
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "SavedView".
 */
export interface SavedView {
  id: string;
  name: ViewName;
  settings: ViewSettings;
  updatedAt: string;
}
/**
 * Body of POST /api/simulations/:id/views. A view of the same name in the simulation is replaced.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "SaveViewRequest".
 */
export interface SaveViewRequest {
  name: ViewName;
  settings: ViewSettings;
}
/**
 * Answer to POST /api/simulations/:id/views.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewResponse".
 */
export interface ViewResponse {
  view: SavedView;
}
/**
 * Answer to GET /api/simulations/:id/views: the simulation's views by name.
 *
 * This interface was referenced by `View`'s JSON-Schema
 * via the `definition` "ViewListResponse".
 */
export interface ViewListResponse {
  views: SavedView[];
}

export const validateViewPoint = validator<ViewPoint>(schema, "ViewPoint");
export const validateViewCamera = validator<ViewCamera>(schema, "ViewCamera");
export const ResultQuantityValues = ["displacement", "vonMises", "principal1", "principal2", "principal3", "stressXX", "stressYY", "stressZZ", "stressXY", "stressYZ", "stressZX", "strainXX", "strainYY", "strainZZ", "strainXY", "strainYZ", "strainZX", "safetyFactor", "temperature"] as const satisfies readonly ResultQuantity[];
export const validateResultQuantity = validator<ResultQuantity>(schema, "ResultQuantity");
export const DeformationValues = ["undeformed", "true", "auto"] as const satisfies readonly Deformation[];
export const validateDeformation = validator<Deformation>(schema, "Deformation");
export const validateViewCut = validator<ViewCut>(schema, "ViewCut");
export const validateViewResult = validator<ViewResult>(schema, "ViewResult");
export const validateViewSettings = validator<ViewSettings>(schema, "ViewSettings");
export const validateViewName = validator<ViewName>(schema, "ViewName");
export const validateSavedView = validator<SavedView>(schema, "SavedView");
export const validateSaveViewRequest = validator<SaveViewRequest>(schema, "SaveViewRequest");
export const validateViewResponse = validator<ViewResponse>(schema, "ViewResponse");
export const validateViewListResponse = validator<ViewListResponse>(schema, "ViewListResponse");
