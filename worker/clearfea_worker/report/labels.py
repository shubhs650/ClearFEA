# SPDX-License-Identifier: AGPL-3.0-or-later
"""What the report calls each analysis, solver, support and load kind and section (M7.3).

The same names the setup shows, from packages/spec/src (simulation.ts, estimator.ts and
reportOptions.ts); tests/test_report_labels.py checks every one is still written there, so the
report and the app cannot drift apart.
"""

ANALYSIS_KINDS: dict[str, str] = {
    "linear_static": "Linear static",
    "steady_thermal": "Steady-state thermal",
    "thermal_stress": "Thermal stress",
    "modal": "Modal",
}

SOLVER_LABELS: dict[str, str] = {
    "pastix": "PaStiX",
    "spooles": "SPOOLES",
    "iterative_cholesky": "Iterative Cholesky",
    "iterative_scaling": "Iterative scaling",
}

SUPPORT_KINDS: dict[str, str] = {
    "fixed": "Fixed support",
    "displacement": "Prescribed displacement",
    "frictionless": "Frictionless support",
    "elastic": "Elastic support",
}

LOAD_KINDS: dict[str, str] = {
    "pressure": "Pressure",
    "force": "Force",
    "remote": "Remote load",
    "hydrostatic": "Hydrostatic pressure",
    "gravity": "Gravity",
    "centrifugal": "Centrifugal load",
    "temperature": "Temperature change",
    "fixed_temperature": "Fixed temperature",
    "heat_flux": "Heat flux",
    "convection": "Convection",
    "radiation": "Radiation",
    "heat_generation": "Heat generation",
}

#: Section headings, as reportSectionLabels names them, without the options' explanations.
SECTION_TITLES: dict[str, str] = {
    "project": "Project and revision",
    "geometry": "Geometry and units",
    "materials": "Materials",
    "mesh": "Mesh statistics",
    "loadsSupports": "Loads and supports",
    "solver": "Solver settings and versions",
    "results": "Result plots",
    "reactions": "Reaction and balance check",
    "extremes": "Minimum and maximum tables",
    "warnings": "Run warnings",
}
