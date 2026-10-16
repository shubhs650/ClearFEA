# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

type View = Annotated[Any, Field(title="View")]
"""
Saved views of a simulation (M3.6, ADR-055): where the camera is, which bodies are hidden and, for views saved on results, what the result view shows. The report (M7) draws its pictures from them. Lengths are in metres. Each message is a definition under $defs.
"""


type ViewPoint = Annotated[list[float], Field(max_length=3, min_length=3)]
"""
x, y, z in metres, in the geometry's axes.
"""


class ViewCamera(BaseModel):
    """
    The camera looks from position at target, with up pointing up on screen. Its field of view is the viewer's own.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    position: ViewPoint
    target: ViewPoint
    up: ViewPoint


type ResultQuantity = Literal[
    "displacement",
    "vonMises",
    "principal1",
    "principal2",
    "principal3",
    "stressXX",
    "stressYY",
    "stressZZ",
    "stressXY",
    "stressYZ",
    "stressZX",
    "strainXX",
    "strainYY",
    "strainZZ",
    "strainXY",
    "strainYZ",
    "strainZX",
    "safetyFactor",
]
"""
A quantity the result view can colour the model by (apps/web/src/viewer/resultFields.ts).
"""


type Deformation = Literal["undeformed", "true", "auto"]
"""
How the result view draws the shape: undeformed, at true scale, or exaggerated to be seen.
"""


class ViewCut(BaseModel):
    """
    A cut plane across one axis (M3.4): at is where along the model it lies, 0 at the smallest coordinate and 1 at the largest; it cuts away the larger coordinates unless flipped.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    axis: Literal[0, 1, 2]
    at: Annotated[float, Field(ge=0.0, le=1.0)]
    flipped: bool


class ViewResult(BaseModel):
    """
    What a view saved on results shows. Probes are not kept: they belong to one run's mesh.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    quantity: ResultQuantity
    deformation: Deformation
    extremes: bool
    """
    Whether the min and max markers are drawn.
    """
    cut: ViewCut | None


class ViewSettings(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    camera: ViewCamera
    hidden_bodies: Annotated[list[int], Field(alias="hiddenBodies")]
    """
    Tags (topology.json) of the bodies not drawn. At least one body of the geometry stays shown.
    """
    result: ViewResult | None
    """
    Null for a view saved on the geometry or the mesh.
    """


type ViewName = Annotated[str, Field(max_length=100, min_length=1, pattern="\\S")]


class SavedView(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: ViewName
    settings: ViewSettings
    updated_at: Annotated[str, Field(alias="updatedAt")]


class SaveViewRequest(BaseModel):
    """
    Body of POST /api/simulations/:id/views. A view of the same name in the simulation is replaced.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    name: ViewName
    settings: ViewSettings


class ViewResponse(BaseModel):
    """
    Answer to POST /api/simulations/:id/views.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    view: SavedView


class ViewListResponse(BaseModel):
    """
    Answer to GET /api/simulations/:id/views: the simulation's views by name.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    views: list[SavedView]
