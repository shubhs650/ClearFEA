# SPDX-License-Identifier: AGPL-3.0-or-later
"""What a report prints (M7.3, ADR-077), as a list of sections of headings, paragraphs, tables and
figures, kept apart from how a DOCX (and in M7.4 a PDF) lays them out.

Everything comes from the job's parameters, built by the API from the run's frozen record, and
from the geometry's topology.json and the run's solver log. Every value prints in the report's
unit system through ReportUnits (M7.6); setup values typed in another unit also print as entered.
Numbers only: nothing here judges a result against a limit (CLAUDE.md hard rules). Pure: no I/O.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from ..spec.geometry_schema import Topology
from ..spec.report_schema import ReportJobFigure, ReportJobParams, ReportJobText
from ..spec.simulation_schema import (
    BalanceCheck,
    CentrifugalLoad,
    ConvectionLoad,
    ElasticSupport,
    FixedTemperatureLoad,
    ForceLoad,
    GravityLoad,
    HeatFluxLoad,
    HeatGenerationLoad,
    HydrostaticLoad,
    IsotropicMaterial,
    MeshQuality,
    NodeValue,
    PrescribedDisplacement,
    PressureLoad,
    PropertyTable,
    Quantity,
    RadiationLoad,
    RemoteLoad,
    RunView,
    SolveResult,
    TemperatureLoad,
)
from .labels import ANALYSIS_KINDS, LOAD_KINDS, SECTION_TITLES, SOLVER_LABELS, SUPPORT_KINDS
from .units import ReportUnits, format_number


@dataclass(frozen=True)
class Paragraph:
    text: str
    #: "body", or "note" for a statement or note set apart from the body text.
    style: str = "body"


@dataclass(frozen=True)
class Heading:
    """A subheading within a section (level 2)."""

    text: str


@dataclass(frozen=True)
class Table:
    """A table with a header row. Captions are numbered when laid out: "Table 3. Reactions"."""

    caption: str
    columns: list[str]
    rows: list[list[str]]
    #: Relative column widths; equal when None.
    widths: list[float] | None = None


@dataclass(frozen=True)
class Figure:
    """One of the run's stored figures. Captions are numbered when laid out: "Figure 2. ..."."""

    file: str
    caption: str
    width: int
    height: int


Block = Paragraph | Heading | Table | Figure


@dataclass(frozen=True)
class Section:
    """A numbered section (level 1)."""

    title: str
    blocks: list[Block]


@dataclass(frozen=True)
class TitleLine:
    label: str
    value: str


@dataclass(frozen=True)
class ReportDocument:
    title: str
    company: str
    #: The logo's file name among the job's downloads, or None.
    logo: str | None
    logo_size: tuple[int, int] | None
    date: str
    #: The title block's filled lines, for the cover.
    cover: list[TitleLine]
    #: What every page header carries: title, document number and revision.
    header: str
    sections: list[Section] = field(default_factory=list)

    def figures(self) -> list[Figure]:
        return [b for s in self.sections for b in s.blocks if isinstance(b, Figure)]


#: How many distinct solver warnings the report lists; the rest are counted.
MAX_WARNINGS = 50

NOT_ENTERED = "(not entered)"

#: The statement printed before the sections; the others close the report.
OPENING_STATEMENT = "toolPositioning"


def report_date(generated_at: str) -> str:
    """The report's date from the time it was asked for: "2026-10-17"."""
    return datetime.fromisoformat(generated_at.replace("Z", "+00:00")).date().isoformat()


def solver_warnings(log: str) -> list[str]:
    """CalculiX's warning lines in a solver log, each once with how often it appears, in the
    order they first appear: "*WARNING in e_c3d: ... (3 times)"."""
    lines = [line.strip() for line in log.splitlines() if "*WARNING" in line.upper()]
    counts = Counter(lines)
    ordered = list(dict.fromkeys(lines))
    out = [f"{line} ({counts[line]} times)" if counts[line] > 1 else line for line in ordered]
    if len(out) > MAX_WARNINGS:
        rest = len(out) - MAX_WARNINGS
        out = out[:MAX_WARNINGS] + [f"... and {rest} other warnings; the solver log has them all."]
    return out


class _Builder:
    """Builds the sections of one report."""

    def __init__(
        self,
        params: ReportJobParams,
        run: RunView,
        topology: Topology | None,
        log: str | None,
    ) -> None:
        self.params = params
        self.run = run
        self.spec = run.spec
        if run.result is None:
            raise ValueError("A report is made from a run that has succeeded.")
        self.result: SolveResult = run.result
        self.topology = topology
        self.log = log
        self.units = ReportUnits.of(params.unit_system)
        self.figures: dict[tuple[str, str], ReportJobFigure] = {
            (f.kind, f.item): f for f in params.figures
        }
        self.body_labels = _body_labels(topology)
        self.face_bodies: dict[int, list[int]] = (
            {} if topology is None else {face.tag: face.bodies for face in topology.faces}
        )

    # Values -----------------------------------------------------------------------------------

    def q(self, quantity: Quantity | None, kind: str) -> str:
        return NOT_ENTERED if quantity is None else self.units.quantity_text(quantity, kind)

    def si(self, value: float, kind: str) -> str:
        return self.units.text(value, kind)

    def number(self, value: float, kind: str) -> str:
        """A value stored in SI, in the report's unit, without the unit (for table cells)."""
        return format_number(self.units.value(value, kind))

    def head(self, label: str, kind: str) -> str:
        """A column heading with its unit: "Fx (N)"; a ratio has none."""
        unit = self.units.unit(kind)
        return label if unit == "1" else f"{label} ({unit})"

    def components(self, values: list[Quantity | None], kind: str) -> str:
        """Three typed components, as one vector in the report's unit: "(0, 0, -9.807) m/s²",
        with the components as entered when any was typed in another unit."""
        unit = self.units.unit(kind)
        if any(v is None for v in values):
            parts = [NOT_ENTERED if v is None else self.q(v, kind) for v in values]
            return "x " + parts[0] + ", y " + parts[1] + ", z " + parts[2]
        typed = [v for v in values if v is not None]
        numbers = ", ".join(format_number(self.units.quantity_value(v, kind)) for v in typed)
        text = f"({numbers}) {unit}" if unit != "1" else f"({numbers})"
        if all(v.unit == unit for v in typed):
            return text
        entered = ", ".join(f"{format_number(v.value)} {v.unit}" for v in typed)
        return f"{text} (entered as {entered})"

    def where(self, value: NodeValue) -> str:
        return f"node {value.node + 1} at {self.units.vector_text(value.position, 'length')}"

    def faces(self, tags: list[int]) -> str:
        """Which faces an item uses, and on which bodies: "2 faces (tags 3, 7) of Block"."""
        count = "1 face" if len(tags) == 1 else f"{len(tags)} faces"
        text = f"{count} (tag{'s' if len(tags) != 1 else ''} {', '.join(map(str, tags))})"
        bodies = sorted({b for tag in tags for b in self.face_bodies.get(tag, [])})
        if bodies:
            text += " of " + ", ".join(self.body_labels.get(b, f"Body {b}") for b in bodies)
        return text

    def figure(self, kind: str, item: str) -> list[Block]:
        found = self.figures.get((kind, item))
        if found is None:
            return [Paragraph("No figure was drawn for this item.")]
        return [Figure(found.file, found.caption, found.width, found.height)]

    # Sections ---------------------------------------------------------------------------------

    def project(self) -> list[Block]:
        t = self.params.title_block
        rows = [
            ["Project", self.params.project_name],
            ["Simulation", self.params.simulation_name],
            ["Report title", t.title],
            ["Document number", t.document_number],
            ["Revision", t.revision],
            ["Prepared by", t.prepared_by],
            ["Checked by", t.checked_by],
            ["Approved by", t.approved_by],
            ["Report date", report_date(self.params.generated_at)],
            ["Run", self.run.id],
            ["Run started", _timestamp(self.run.created_at)],
            ["Run finished", _timestamp(self.run.finished_at)],
            ["Analysis type", ANALYSIS_KINDS[self.spec.analysis]],
        ]
        rows = [r for r in rows if r[1]]
        return [Table("Project and revision", ["Item", "Value"], rows, [1, 2])]

    def geometry(self) -> list[Block]:
        rows = [
            ["Geometry file", self.params.geometry.name],
            ["Length unit of the file", self.params.geometry.unit or "(not confirmed)"],
            ["Unit system of this report", self.units.name],
        ]
        blocks: list[Block] = []
        if self.topology is not None:
            box = self.topology.bbox
            extents = [box[3] - box[0], box[4] - box[1], box[5] - box[2]]
            rows += [
                ["Size along x, y, z", self.units.vector_text(extents, "length")],
                ["Bodies", str(len(self.topology.bodies))],
                ["Faces", str(len(self.topology.faces))],
            ]
        tied = [b for b in self.spec.bonds or [] if b.status != "removed"]
        if self.spec.bonds is not None:
            rows.append(["Bonded face pairs", str(len(tied))])
        blocks.append(Table("Geometry", ["Item", "Value"], rows, [1, 2]))
        materials = {m.id: m.name for m in self.spec.materials}
        if self.topology is not None:
            body_rows = [
                [
                    self.body_labels.get(b.tag, f"Body {b.tag}"),
                    str(b.tag),
                    materials.get(assigned, NOT_ENTERED) if assigned else NOT_ENTERED,
                    str(len(b.faces)),
                ]
                for b in self.topology.bodies
                for assigned in [_assigned(self.spec.bodies, b.tag)]
            ]
            blocks.append(
                Table("Bodies", ["Body", "Tag", "Material", "Faces"], body_rows, [2, 1, 2, 1])
            )
        kinds = _kinds_used(self.spec.analysis)
        blocks.append(Paragraph(f"Every value in this report is in the {self.units.name} system:"))
        blocks.append(
            Table(
                "Units used in this report",
                ["Quantity", "Unit"],
                [[_KIND_NAMES[k], self.units.unit(k)] for k in kinds],
                [2, 1],
            )
        )
        return blocks

    def materials(self) -> list[Block]:
        blocks: list[Block] = []
        used: dict[str, list[str]] = {}
        for body in self.spec.bodies:
            if body.material is not None:
                used.setdefault(body.material, []).append(
                    self.body_labels.get(body.tag, f"Body {body.tag}")
                )
        for material in self.spec.materials:
            blocks.append(Heading(material.name))
            blocks.extend(self.material(material, used.get(material.id, [])))
        if not blocks:
            blocks.append(Paragraph("The setup has no materials."))
        return blocks

    def material(self, m: IsotropicMaterial, bodies: list[str]) -> list[Block]:
        rows = [
            ["Bodies", ", ".join(bodies) or "(none)"],
            ["Model", "Linear elastic, isotropic"],
            ["Young's modulus", self.q(m.youngs_modulus, "pressure")],
            [
                "Poisson's ratio",
                NOT_ENTERED if m.poissons_ratio is None else format_number(m.poissons_ratio),
            ],
        ]
        optional = [
            ("Density", m.density, "density"),
            ("Thermal expansion coefficient", m.thermal_expansion, "thermalExpansion"),
            ("Thermal conductivity", m.thermal_conductivity, "thermalConductivity"),
            ("Yield strength", m.yield_strength, "pressure"),
        ]
        rows += [[label, self.q(value, kind)] for label, value, kind in optional if value]
        if m.source:
            rows.append(["Source", m.source])
        blocks: list[Block] = [Table(f"Material {m.name}", ["Property", "Value"], rows, [1, 2])]
        tables = [
            ("Young's modulus", m.youngs_modulus_table, "pressure"),
            ("Poisson's ratio", m.poissons_ratio_table, "ratio"),
            ("Thermal expansion coefficient", m.thermal_expansion_table, "thermalExpansion"),
            ("Thermal conductivity", m.thermal_conductivity_table, "thermalConductivity"),
        ]
        for label, table, kind in tables:
            if table is not None and table.rows:
                blocks.append(self.property_table(m.name, label, table, kind))
        if m.thermal_expansion_table is not None and m.thermal_expansion_table.rows:
            reference = self.q(m.thermal_expansion_table.reference_temperature, "temperature")
            blocks.append(
                Paragraph(
                    "The thermal expansion coefficients are mean coefficients measured from "
                    f"{reference}."
                )
            )
        return blocks

    def property_table(self, name: str, label: str, table: PropertyTable, kind: str) -> Table:
        rows = []
        for row in table.rows:
            if row.temperature is None or row.value is None:
                continue
            temperature = Quantity(value=row.temperature, unit=table.temperature_unit)
            value = (
                format_number(row.value)
                if kind == "ratio"
                else format_number(
                    self.units.quantity_value(Quantity(value=row.value, unit=table.unit), kind)
                )
            )
            rows.append(
                [format_number(self.units.quantity_value(temperature, "temperature")), value]
            )
        return Table(
            f"{label} of {name} against temperature",
            [self.head("Temperature", "temperature"), self.head(label, kind)],
            rows,
        )

    def mesh(self) -> list[Block]:
        mesh = self.run.mesh
        order = (
            "Second order (10-node tetrahedra, C3D10)"
            if mesh.order == 2
            else "First order (4-node tetrahedra, C3D4)"
        )
        rows = [
            ["Global element size", self.q(mesh.size, "length")],
            ["Element order", order],
            ["Nodes", _count(mesh.node_count)],
            ["Elements", _count(mesh.element_count)],
        ]
        quality = (
            None
            if self.params.mesh_quality is None
            else MeshQuality.model_validate(self.params.mesh_quality)
        )
        if quality is not None:
            rows += [
                ["Smallest element shape (gamma)", format_number(quality.shape_min)],
                ["Mean element shape (gamma)", format_number(quality.shape_mean)],
                ["Smallest scaled Jacobian", format_number(quality.jacobian_min)],
            ]
        blocks: list[Block] = [Table("Mesh", ["Item", "Value"], rows, [1, 2])]
        local = self.spec.mesh.local or []
        if local:
            blocks.append(
                Table(
                    "Local element sizes",
                    ["Name", "Applies to", "Size"],
                    [[s.name, f"{len(s.tags)} {s.scope}", self.q(s.size, "length")] for s in local],
                    [2, 1, 2],
                )
            )
        if quality is not None:
            blocks.append(
                Paragraph(
                    "Element shape is Gmsh's gamma, the ratio of inscribed to circumscribed sphere "
                    "radius scaled so that a regular tetrahedron is 1 and a flat one 0."
                )
            )
            bands = [f"{i / 10:.1f} to {(i + 1) / 10:.1f}" for i in range(10)]
            blocks.append(
                Table(
                    "Elements by shape",
                    ["Shape (gamma)", "Elements"],
                    [
                        [band, f"{n:,}"]
                        for band, n in zip(bands, quality.shape_histogram, strict=True)
                    ],
                )
            )
        return blocks

    def loads_supports(self) -> list[Block]:
        blocks: list[Block] = []
        for support in self.spec.supports:
            blocks.append(Heading(f"{support.name} ({SUPPORT_KINDS[support.type].lower()})"))
            rows = [["Kind", SUPPORT_KINDS[support.type]], ["Faces", self.faces(support.faces)]]
            rows += self.support_rows(support)
            blocks.append(Table(support.name, ["Item", "Value"], rows, [1, 2]))
            blocks.extend(self.figure("support", support.id))
        for load in self.spec.loads:
            blocks.append(Heading(f"{load.name} ({LOAD_KINDS[load.type].lower()})"))
            rows = [["Kind", LOAD_KINDS[load.type]]]
            faces = getattr(load, "faces", None)
            if faces is not None:
                rows.append(["Faces", self.faces(faces)])
            rows += self.load_rows(load)
            blocks.append(Table(load.name, ["Item", "Value"], rows, [1, 2]))
            blocks.extend(self.figure("load", load.id))
        if not blocks:
            blocks.append(Paragraph("The setup has no supports or loads."))
        return blocks

    def support_rows(self, support: object) -> list[list[str]]:
        if isinstance(support, PrescribedDisplacement):
            return [
                [
                    f"Displacement {axis}",
                    "free"
                    if value == "free"
                    else self.q(value if isinstance(value, Quantity) else None, "length"),
                ]
                for axis, value in (("x", support.x), ("y", support.y), ("z", support.z))
            ]
        if isinstance(support, ElasticSupport):
            return [["Stiffness per unit area", self.q(support.stiffness, "foundationStiffness")]]
        return []

    def load_rows(self, load: object) -> list[list[str]]:  # noqa: C901 - one branch per load type
        if isinstance(load, PressureLoad):
            return [["Pressure", self.q(load.magnitude, "pressure")]]
        if isinstance(load, ForceLoad):
            return [["Total force", self.components([load.x, load.y, load.z], "force")]]
        if isinstance(load, GravityLoad):
            return [["Acceleration", self.components([load.x, load.y, load.z], "acceleration")]]
        if isinstance(load, TemperatureLoad):
            return [["Temperature change", self.q(load.change, "temperatureDifference")]]
        if isinstance(load, CentrifugalLoad):
            d = load.axis_direction
            direction = (
                NOT_ENTERED
                if None in (d.x, d.y, d.z)
                else "(" + ", ".join(format_number(v or 0.0) for v in (d.x, d.y, d.z)) + ")"
            )
            p = load.axis_point
            return [
                ["Angular velocity", self.q(load.angular_velocity, "angularVelocity")],
                ["Point on the axis", self.components([p.x, p.y, p.z], "length")],
                ["Axis direction", direction],
            ]
        if isinstance(load, RemoteLoad):
            p, f, m = load.point, load.force, load.moment
            return [
                ["Reference point", self.components([p.x, p.y, p.z], "length")],
                ["Force", self.components([f.x, f.y, f.z], "force")],
                ["Moment about the point", self.components([m.x, m.y, m.z], "moment")],
            ]
        if isinstance(load, HydrostaticLoad):
            g, s = load.gravity, load.free_surface
            return [
                ["Fluid density", self.q(load.fluid_density, "density")],
                ["Gravity", self.components([g.x, g.y, g.z], "acceleration")],
                ["Point on the free surface", self.components([s.x, s.y, s.z], "length")],
            ]
        if isinstance(load, FixedTemperatureLoad):
            return [["Temperature", self.q(load.temperature, "temperature")]]
        if isinstance(load, HeatFluxLoad):
            return [["Heat flux into the faces", self.q(load.flux, "heatFlux")]]
        if isinstance(load, ConvectionLoad):
            return [
                ["Film coefficient", self.q(load.coefficient, "heatTransferCoefficient")],
                ["Ambient temperature", self.q(load.ambient_temperature, "temperature")],
            ]
        if isinstance(load, RadiationLoad):
            emissivity = NOT_ENTERED if load.emissivity is None else format_number(load.emissivity)
            return [
                ["Emissivity", emissivity],
                ["Surroundings temperature", self.q(load.ambient_temperature, "temperature")],
            ]
        if isinstance(load, HeatGenerationLoad):
            bodies = ", ".join(self.body_labels.get(b, f"Body {b}") for b in load.bodies)
            return [
                ["Bodies", bodies],
                ["Heat generated per unit volume", self.q(load.power, "heatGeneration")],
            ]
        return []

    def solver(self) -> list[Block]:
        spec, run = self.spec, self.run
        solver = spec.solver or "spooles"
        rows = [
            ["Analysis type", ANALYSIS_KINDS[spec.analysis]],
            ["Equation solver", SOLVER_LABELS[solver]],
        ]
        if spec.analysis == "modal":
            rows.append(["Modes asked for", str(spec.modes) if spec.modes else NOT_ENTERED])
        if spec.analysis == "thermal_stress":
            rows.append(
                ["Stress-free temperature", self.q(spec.stress_free_temperature, "temperature")]
            )
        if run.machine is not None:
            rows.append(["Machine size", run.machine.size])
        if run.cost is not None:
            rows.append(["Billed solve time", f"{run.cost.billed_seconds} s"])
        s = run.software
        versions = [
            ["ClearFEA", s.clearfea],
            ["Deck format", None if s.deck_format is None else str(s.deck_format)],
            ["CalculiX", s.calculix],
            ["Gmsh", s.gmsh],
            ["OpenCASCADE", s.occt],
        ]
        return [
            Table("Solver settings", ["Setting", "Value"], rows, [1, 2]),
            Table(
                "Software versions",
                ["Software", "Version"],
                [[name, value or "(not recorded)"] for name, value in versions],
                [1, 2],
            ),
            Paragraph(
                "The solver input was written by ClearFEA's deck generator from the setup in this "
                "report and the run's mesh; both are kept unchanged with the run."
            ),
        ]

    def results(self) -> list[Block]:
        blocks: list[Block] = [
            Figure(f.file, f.caption, f.width, f.height)
            for f in self.params.figures
            if f.kind == "view"
        ]
        if not blocks:
            blocks.append(
                Paragraph("No result views were picked for this report, so it has no result plots.")
            )
        return blocks

    def reactions(self) -> list[Block]:
        if self.spec.analysis == "modal":
            return [
                Paragraph(
                    "A modal analysis applies no loads, so it has no reactions or balance check."
                )
            ]
        blocks: list[Block] = []
        r = self.result
        if self.spec.analysis in ("steady_thermal", "thermal_stress"):
            blocks += self.heat_balance(r)
        if self.spec.analysis != "steady_thermal":
            blocks += self.force_balance(r)
        return blocks

    def heat_balance(self, r: SolveResult) -> list[Block]:
        names = {load.id: load.name for load in self.spec.loads}
        blocks: list[Block] = [Heading("Heat balance")]
        if r.heat_flows:
            blocks.append(
                Table(
                    "Heat flow of each thermal load into the bodies (negative out)",
                    ["Load", self.head("Heat flow", "heatFlow")],
                    [
                        [names.get(f.load_id, f.load_id), self.number(f.heat, "heatFlow")]
                        for f in r.heat_flows
                    ],
                    [2, 1],
                )
            )
        if r.heat_balance is not None:
            b = r.heat_balance
            blocks.append(
                Table(
                    "Heat balance",
                    ["Item", "Value"],
                    [
                        ["Heat in", self.si(b.heat_in, "heatFlow")],
                        ["Heat out", self.si(b.heat_out, "heatFlow")],
                        ["Difference over the loads' heat", _percent(b.ratio)],
                    ],
                    [2, 1],
                )
            )
        else:
            blocks.append(Paragraph("This run was solved before heat balances were recorded."))
        return blocks

    def force_balance(self, r: SolveResult) -> list[Block]:
        names = {s.id: s.name for s in self.spec.supports}
        load_names = {load.id: load.name for load in self.spec.loads}
        blocks: list[Block] = [Heading("Reactions")]
        f = self.head
        if r.reactions:
            rows = []
            for reaction in r.reactions:
                force = [self.number(v, "force") for v in reaction.force]
                moment = (
                    ["", "", ""]
                    if reaction.moment is None
                    else [self.number(v, "moment") for v in reaction.moment]
                )
                rows.append([names.get(reaction.support_id, reaction.support_id), *force, *moment])
            blocks.append(
                Table(
                    "Reaction of each support; moments about the centroid of its faces",
                    [
                        "Support",
                        f("Fx", "force"),
                        f("Fy", "force"),
                        f("Fz", "force"),
                        f("Mx", "moment"),
                        f("My", "moment"),
                        f("Mz", "moment"),
                    ],
                    rows,
                    [2, 1, 1, 1, 1, 1, 1],
                )
            )
        if r.loads:
            rows = [
                [
                    load_names.get(t.load_id, t.load_id),
                    *[self.number(v, "force") for v in t.force],
                    *[self.number(v, "moment") for v in t.moment],
                ]
                for t in r.loads
            ]
            blocks.append(
                Table(
                    "Total of each load as applied; moments about the origin",
                    [
                        "Load",
                        f("Fx", "force"),
                        f("Fy", "force"),
                        f("Fz", "force"),
                        f("Mx", "moment"),
                        f("My", "moment"),
                        f("Mz", "moment"),
                    ],
                    rows,
                    [2, 1, 1, 1, 1, 1, 1],
                )
            )
        if r.balance is not None:
            blocks.append(Heading("Balance check"))
            blocks += self.balance(r.balance)
        else:
            blocks.append(Paragraph("This run was solved before balance checks were recorded."))
        return blocks

    def balance(self, b: BalanceCheck) -> list[Block]:
        v = self.units.vector_text
        rows = [
            ["Applied force", v(b.applied_force, "force")],
            ["Reaction force", v(b.reaction_force, "force")],
            ["Applied moment about the origin", v(b.applied_moment, "moment")],
            ["Reaction moment about the origin", v(b.reaction_moment, "moment")],
            ["Force out of balance, over the loads' size", _percent(b.force_ratio)],
            ["Moment out of balance, over its scale", _percent(b.moment_ratio)],
        ]
        return [
            Table("Applied loads against reactions", ["Item", "Value"], rows, [3, 2]),
            Paragraph(
                "The force out of balance is the size of the sum of applied loads and reactions "
                "over the larger of the loads' gross size and the reactions' total size; the "
                "moment is measured likewise. They show how closely the solved model is in "
                "equilibrium."
            ),
        ]

    def extremes(self) -> list[Block]:
        r = self.result
        if self.spec.analysis == "modal":
            frequencies = r.frequencies or []
            return [
                Table(
                    "Natural frequencies",
                    ["Mode", self.head("Frequency", "frequency")],
                    [
                        [str(i + 1), self.number(hz, "frequency")]
                        for i, hz in enumerate(frequencies)
                    ],
                ),
                Paragraph(
                    "Bodies that no support holds have rigid-body modes at or near zero frequency."
                ),
            ]
        rows: list[list[str]] = []

        def add(label: str, kind: str, low: NodeValue | None, high: NodeValue | None) -> None:
            rows.append(
                [
                    label,
                    "" if low is None else self.si(low.value, kind),
                    "" if low is None else self.where(low),
                    "" if high is None else self.si(high.value, kind),
                    "" if high is None else self.where(high),
                ]
            )

        if r.displacement is not None:
            add("Displacement magnitude", "length", None, r.displacement.max)
        if r.von_mises is not None:
            add("Von Mises stress", "pressure", r.von_mises.min, r.von_mises.max)
        if r.temperature is not None:
            add("Temperature", "temperature", r.temperature.min, r.temperature.max)
        if r.heat_flux is not None:
            add("Heat flux magnitude", "heatFlux", None, r.heat_flux.max)
        if r.safety_factor is not None:
            add("Safety factor against yield", "ratio", r.safety_factor.min, None)
        blocks: list[Block] = [
            Table(
                "Smallest and largest values at the nodes",
                ["Quantity", "Minimum", "Where", "Maximum", "Where"],
                rows,
                [2, 1.3, 2.2, 1.3, 2.2],
            ),
            Paragraph(
                f"Nodes are numbered from 1 in the run's mesh of {_count(self.result.nodes)} "
                "nodes. Stresses are CalculiX's values extrapolated to the nodes and averaged there."
            ),
        ]
        if r.safety_factor is not None:
            blocks.append(
                Paragraph(
                    "The safety factor is each material's yield strength over the von Mises stress "
                    "at each node. It is a number computed from the model, not an assessment of "
                    "the part."
                )
            )
        return blocks

    def warnings(self) -> list[Block]:
        if self.log is None:
            return [
                Paragraph("The run's solver log is not available, so its warnings are not listed.")
            ]
        found = solver_warnings(self.log)
        if not found:
            return [Paragraph("CalculiX printed no warnings for this run.")]
        return [
            Paragraph(f"CalculiX printed these warnings while it solved the run ({len(found)}):"),
            *[Paragraph(line, "note") for line in found],
        ]

    def build(self) -> list[Section]:
        params = self.params
        opening = [s for s in params.statements if s.id == OPENING_STATEMENT]
        closing = [s for s in params.statements if s.id != OPENING_STATEMENT]
        sections: list[Section] = []
        if opening:
            sections.append(Section(opening[0].title, [Paragraph(opening[0].text, "note")]))
        builders = {
            "project": self.project,
            "geometry": self.geometry,
            "materials": self.materials,
            "mesh": self.mesh,
            "loadsSupports": self.loads_supports,
            "solver": self.solver,
            "results": self.results,
            "reactions": self.reactions,
            "extremes": self.extremes,
            "warnings": self.warnings,
        }
        for name in params.sections:
            title = SECTION_TITLES[name]
            if name == "reactions" and self.spec.analysis == "steady_thermal":
                title = "Heat balance check"
            sections.append(Section(title, builders[name]()))
        if params.notes:
            sections.append(Section("Notes on accuracy", _texts(params.notes)))
        if closing:
            sections.append(Section("Software and verification", _texts(closing)))
        return sections


def build_report(
    params: ReportJobParams, topology: Topology | None, log: str | None
) -> ReportDocument:
    """The report of a succeeded run: its cover and sections, in printing order."""
    run = RunView.model_validate(params.run)
    if run.status != "succeeded" or run.result is None:
        raise ValueError("A report is made from a run that has succeeded.")
    t = params.title_block
    lines = [
        TitleLine("Document number", t.document_number),
        TitleLine("Revision", t.revision),
        TitleLine("Date", report_date(params.generated_at)),
        TitleLine("Prepared by", t.prepared_by),
        TitleLine("Checked by", t.checked_by),
        TitleLine("Approved by", t.approved_by),
    ]
    title = t.title or params.simulation_name
    header = " · ".join(
        part
        for part in [
            title,
            t.document_number,
            f"Revision {t.revision}" if t.revision else "",
        ]
        if part
    )
    return ReportDocument(
        title=title,
        company=params.company_name,
        logo="logo" if params.logo is not None else None,
        logo_size=None if params.logo is None else (params.logo.width, params.logo.height),
        date=report_date(params.generated_at),
        cover=[line for line in lines if line.value],
        header=header,
        sections=_Builder(params, run, topology, log).build(),
    )


def _texts(texts: list[ReportJobText]) -> list[Block]:
    blocks: list[Block] = []
    for text in texts:
        blocks += [Heading(text.title), Paragraph(text.text, "note")]
    return blocks


def _body_labels(topology: Topology | None) -> dict[int, str]:
    """The setup's name for each body, as bodyLabels in packages/spec/src/simulation.ts: its part
    name, "Body <tag>" when it has none, and the tag added to a name several bodies share."""
    if topology is None:
        return {}
    uses = Counter(b.name for b in topology.bodies if b.name is not None)
    return {
        b.tag: f"Body {b.tag}"
        if b.name is None
        else (f"{b.name} (body {b.tag})" if uses[b.name] > 1 else b.name)
        for b in topology.bodies
    }


def _assigned(bodies: list, tag: int) -> str | None:
    for body in bodies:
        if body.tag == tag:
            return body.material
    return None


def _count(value: int | None) -> str:
    return "(not recorded)" if value is None else f"{value:,}"


def _percent(ratio: float) -> str:
    return f"{format_number(ratio * 100)} %"


def _timestamp(value: str | None) -> str:
    """A stored UTC time as "2026-10-17 03:12 UTC"."""
    if not value:
        return ""
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return moment.strftime("%Y-%m-%d %H:%M UTC")


#: What the units table is printed as, per kind.
_KIND_NAMES: dict[str, str] = {
    "length": "Length",
    "force": "Force",
    "moment": "Moment",
    "pressure": "Pressure and stress",
    "density": "Density",
    "acceleration": "Acceleration",
    "angularVelocity": "Angular velocity",
    "foundationStiffness": "Elastic support stiffness",
    "temperature": "Temperature",
    "temperatureDifference": "Temperature change",
    "thermalExpansion": "Thermal expansion coefficient",
    "thermalConductivity": "Thermal conductivity",
    "heatFlux": "Heat flux",
    "heatTransferCoefficient": "Film coefficient",
    "heatGeneration": "Heat generation",
    "heatFlow": "Heat flow",
    "frequency": "Frequency",
}

_STRUCTURAL = ["length", "force", "moment", "pressure", "density", "acceleration"]
_THERMAL = [
    "temperature",
    "thermalConductivity",
    "heatFlux",
    "heatTransferCoefficient",
    "heatGeneration",
    "heatFlow",
]


def _kinds_used(analysis: str) -> list[str]:
    """The quantity kinds whose units a report of this analysis lists."""
    if analysis == "steady_thermal":
        return ["length", *_THERMAL]
    if analysis == "modal":
        return ["length", "pressure", "density", "frequency"]
    kinds = [*_STRUCTURAL, "temperatureDifference", "thermalExpansion"]
    if analysis == "thermal_stress":
        kinds = [*_STRUCTURAL, "thermalExpansion", *_THERMAL]
    return kinds
