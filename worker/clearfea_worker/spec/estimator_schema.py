# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

type FittedNode = Annotated[int, Field(ge=1)]


class PowerLaw(BaseModel):
    """
    constant + coefficient * nodes ^ exponent, where nodes is the mesh's node count.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    constant: Annotated[float, Field(ge=0.0)]
    coefficient: Annotated[float, Field(gt=0.0)]
    exponent: Annotated[float, Field(gt=0.0)]
    largest_ratio: Annotated[float, Field(alias="largestRatio", gt=0.0)]
    """
    Largest measured value over the fitted one among the measurements: how far the fit fell short at worst.
    """


class AnalysisModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    solver: str
    """
    The solver and threads the fit was measured with.
    """
    peak_memory_bytes: Annotated[PowerLaw, Field(alias="peakMemoryBytes")]
    """
    Peak resident memory of the solver process.
    """
    job_seconds: Annotated[PowerLaw, Field(alias="jobSeconds")]
    """
    Wall time of the solve job's billable phase: writing the deck, the solver, reading results and writing the viewer's files.
    """
    fitted_nodes: Annotated[
        list[FittedNode], Field(alias="fittedNodes", max_length=2, min_length=2)
    ]
    """
    Smallest and largest node count among the measurements; outside this range the estimate is an extrapolation.
    """


class Analyses(BaseModel):
    """
    One model per analysis type a run can have.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    linear_static: AnalysisModel


class EstimatorTable(BaseModel):
    """
    Shape of packages/spec/estimator.json, the run estimator's fitted coefficients (ARCHITECTURE.md, Estimator; ADR-049). Written by worker/benchmarks/solver/fit.py from the benchmark data; never edited by hand. Every quantity is SI: bytes and seconds.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    version: Annotated[int, Field(ge=1)]
    """
    Bumped whenever a coefficient changes, so a run's frozen estimate says which fit made it.
    """
    source: str
    """
    Where the fit's data came from, for people.
    """
    analyses: Analyses
    """
    One model per analysis type a run can have.
    """
    memory_margin: Annotated[float, Field(alias="memoryMargin", ge=1.0)]
    """
    Factor on the fitted peak memory that a machine size must hold before it is recommended. Recommendations are conservative on memory, because the platform pays when its recommendation is too small (ARCHITECTURE.md).
    """
    usable_memory_fraction: Annotated[float, Field(alias="usableMemoryFraction", gt=0.0, le=1.0)]
    """
    Share of a machine size's memory the solver may use; the rest is left to the system and the worker.
    """
