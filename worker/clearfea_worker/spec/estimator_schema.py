# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run `make spec`.

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

type FittedNode = Annotated[int, Field(ge=1)]


type FittedMode = Annotated[int, Field(ge=1)]


class MaxElements(BaseModel):
    """
    Largest element count a run with this solver may have, per element order, on a machine of limitMemoryBytes: the node count whose fitted peak memory times memoryMargin fits in usableMemoryFraction of it, turned into elements with the nodes per element of the measured mesh nearest it, at most the largest mesh measured, rounded down to a thousand.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    order1: Annotated[int, Field(ge=1)]
    """
    Four-node tetrahedra.
    """
    order2: Annotated[int, Field(ge=1)]
    """
    Ten-node tetrahedra.
    """


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


class ModalModel(BaseModel):
    """
    A modal run's peak memory and job time are a part for the mesh plus a part per mode found: peakMemoryBytes + modes × peakMemoryBytesPerMode, and the same for jobSeconds (M6.3). Each part is a power law in the node count. The largestRatio of peakMemoryBytes and jobSeconds is the worst shortfall of the whole sum among the modal measurements.
    """

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
    Peak resident memory of the solver process, the part that does not grow with the modes.
    """
    peak_memory_bytes_per_mode: Annotated[PowerLaw, Field(alias="peakMemoryBytesPerMode")]
    """
    Peak resident memory added by each mode asked for.
    """
    job_seconds: Annotated[PowerLaw, Field(alias="jobSeconds")]
    """
    Wall time of the solve job's billable phase, the part that does not grow with the modes.
    """
    job_seconds_per_mode: Annotated[PowerLaw, Field(alias="jobSecondsPerMode")]
    """
    Wall time added by each mode asked for.
    """
    fitted_nodes: Annotated[
        list[FittedNode], Field(alias="fittedNodes", max_length=2, min_length=2)
    ]
    """
    Smallest and largest node count among the measurements; outside this range the estimate is an extrapolation.
    """
    fitted_modes: Annotated[
        list[FittedMode], Field(alias="fittedModes", max_length=2, min_length=2)
    ]
    """
    Fewest and most modes among the measurements.
    """
    max_elements: Annotated[MaxElements, Field(alias="maxElements")]
    """
    As for a linear static run, for a modal run that asks for the most modes a setup may have (100), so the limit holds for every modal run.
    """


class JobSecondsByOrder(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    order1: PowerLaw
    """
    Four-node tetrahedra.
    """
    order2: PowerLaw
    """
    Ten-node tetrahedra.
    """


class ModalSolverModels(BaseModel):
    """
    One model per equation solver a modal run may use (M6.3). A solver without one cannot solve a modal run: CalculiX refuses the iterative solvers on a frequency step (ADR-070), and PaStiX is not measured (ADR-072).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    pastix: ModalModel | None = None
    spooles: ModalModel | None = None


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
    Peak resident memory of the solver process, for both element orders.
    """
    job_seconds_by_order: Annotated[JobSecondsByOrder, Field(alias="jobSecondsByOrder")]
    """
    Wall time of the solve job's billable phase (writing the deck, the solver, reading results and writing the viewer's files), fitted per element order: per node a ten-node mesh takes longer to solve than a four-node one, most of all with the iterative solvers (M8.9).
    """
    fitted_nodes: Annotated[
        list[FittedNode], Field(alias="fittedNodes", max_length=2, min_length=2)
    ]
    """
    Smallest and largest node count among the measurements; outside this range the estimate is an extrapolation.
    """
    max_elements: Annotated[MaxElements, Field(alias="maxElements")]


class SolverModels(BaseModel):
    """
    One model per equation solver a run can use (ADR-063), keyed as SimulationSpec's solver.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    pastix: AnalysisModel
    spooles: AnalysisModel
    iterative_cholesky: AnalysisModel
    iterative_scaling: AnalysisModel


class Analyses(BaseModel):
    """
    One model per analysis type a run can have.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    linear_static: SolverModels
    """
    Linear static runs; steady-state thermal and thermal stress runs are estimated with it too (ADR-064).
    """
    modal: ModalSolverModels


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
    limit_memory_bytes: Annotated[int, Field(alias="limitMemoryBytes", ge=1)]
    """
    Memory of the machine the element limits are for (ADR-063): 16 GiB in Phase 0. A run whose mesh has more elements than its solver's limit is refused.
    """
