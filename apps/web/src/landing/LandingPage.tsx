// SPDX-License-Identifier: AGPL-3.0-or-later
// The landing page at / (M10.4, ADR-095): what ClearFEA does, how it works, the analyses, the
// verification results, open source and the closed beta, with the way in to the workbench at /app.
// It never signs anyone in itself: every sign-in button is a link to /app, which shows the sign-in.

import {
  Activity,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  Cpu,
  Download,
  FileText,
  Flame,
  Github,
  Layers,
  Lock,
  Moon,
  Scale,
  Scissors,
  SlidersHorizontal,
  Sun,
  Thermometer,
  Upload,
  Waves,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { fetchSession } from "../api/session";
import { Logo } from "../layout/AppHeader";
import { useTheme } from "../layout/theme";
import { WORKBENCH_PATH } from "../pages";
import {
  REPOSITORY_URL,
  SELF_HOSTING_URL,
  USER_GUIDE_URL,
  VERIFICATION_RESULTS_URL,
  VERIFICATION_ROWS,
  VERIFICATION_SUMMARY,
} from "./content";
import "./landing.css";

/** Who is looking: unknown until /api/session answers, then signed in or not. */
type Visitor = "unknown" | "signed-in" | "signed-out";

function useVisitor(): Visitor {
  const [visitor, setVisitor] = useState<Visitor>("unknown");
  useEffect(() => {
    let current = true;
    fetchSession().then((result) => {
      if (current) setVisitor(result.kind === "ok" ? "signed-in" : "signed-out");
    });
    return () => {
      current = false;
    };
  }, []);
  return visitor;
}

/** Google's "G", drawn in its own colours as Google's sign-in button guidelines ask. */
function GoogleMark() {
  return (
    <svg className="landing-google" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** The way in: "Open the workbench" for a signed-in visitor, otherwise the sign-in. */
function SignInLink({ visitor, size }: { visitor: Visitor; size: "small" | "large" }) {
  const className = `landing-button landing-button-primary landing-button-${size}`;
  if (visitor === "signed-in") {
    return (
      <a className={className} href={WORKBENCH_PATH}>
        Open the workbench
        <ArrowRight size={size === "large" ? 18 : 16} aria-hidden="true" />
      </a>
    );
  }
  return (
    <a className={className} href={WORKBENCH_PATH}>
      {size === "large" && <GoogleMark />}
      {size === "large" ? "Sign in with Google" : "Sign in"}
    </a>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tinted = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
  tinted?: boolean;
}) {
  return (
    <section id={id} className={tinted ? "landing-section landing-section-tinted" : "landing-section"} aria-labelledby={`${id}-title`}>
      <div className="landing-container">
        <p className="landing-eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`} className="landing-h2">
          {title}
        </h2>
        {lead && <p className="landing-lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

/** A screenshot of the workbench in a window frame; the dark one shows in the dark theme. */
function Screenshot({ light, dark, alt, hero = false }: { light: string; dark?: string; alt: string; hero?: boolean }) {
  return (
    <figure className={hero ? "landing-window landing-hero-shot" : "landing-window"}>
      <div className="landing-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <p>clearfea.triyalabs.com/app</p>
      </div>
      <img className={dark ? "landing-shot landing-shot-light" : "landing-shot"} src={light} alt={alt} width={1600} height={900} />
      {dark && <img className="landing-shot landing-shot-dark" src={dark} alt="" width={1600} height={900} loading="lazy" />}
    </figure>
  );
}

const STEPS = [
  {
    icon: Upload,
    title: "Upload a STEP model",
    text: "One solid or an assembly. The length unit is read from the file, and touching faces between bodies are found and bonded for you to review.",
  },
  {
    icon: SlidersHorizontal,
    title: "Set it up in the browser",
    text: "Pick faces in the 3D view for supports and loads, choose materials from the library or your own, and type every value in the unit you think in.",
  },
  {
    icon: Cpu,
    title: "Mesh and solve in the cloud",
    text: "An automatic tetrahedral mesh with local refinement, shown before the run with an estimate of time and memory. CalculiX solves it on a 4-core, 16 GB machine.",
  },
  {
    icon: FileText,
    title: "Read the results, take the report",
    text: "Contours on the deformed shape, probes, cut planes and the reaction balance, then a structured report in Word and PDF.",
  },
];

const ANALYSES = [
  {
    icon: Activity,
    title: "Linear static",
    text: "Displacements, stresses, strains and reactions under mechanical loads, with a balance check of reactions against applied loads.",
  },
  {
    icon: Waves,
    title: "Modal",
    text: "Natural frequencies and mode shapes of the bodies as their supports hold them, up to 100 modes, animated in the viewer.",
  },
  {
    icon: Thermometer,
    title: "Steady-state thermal",
    text: "Temperatures and heat flux from fixed temperatures, heat flux, convection, radiation and heat generation, with the heat balance.",
  },
  {
    icon: Flame,
    title: "Thermal stress",
    text: "The thermal solution carried into a static one in a single run, with properties that may vary with temperature.",
  },
];

const LOADS = [
  "Pressure",
  "Force",
  "Remote force and moment",
  "Hydrostatic pressure",
  "Gravity",
  "Centrifugal load",
  "Temperature change",
  "Fixed support",
  "Prescribed displacement",
  "Frictionless (symmetry)",
  "Elastic support",
  "Convection",
  "Radiation",
  "Heat generation",
];

const RESULT_FEATURES = [
  { icon: Scale, text: "Reactions and the balance against the applied loads, for every run" },
  { icon: Scissors, text: "Cut planes and probes to read values inside the part" },
  { icon: Layers, text: "Multi-body assemblies with every bond listed for review" },
  { icon: Download, text: "Results as CSV and VTK, for ParaView or your own scripts" },
  { icon: FileText, text: "A twelve-section report in Word and PDF, with your saved views" },
  { icon: Box, text: "The exact CalculiX input and log of every run, to repeat it anywhere" },
];

export function LandingPage() {
  const visitor = useVisitor();
  const [theme, setTheme] = useTheme();
  const summary = VERIFICATION_SUMMARY;

  return (
    <div className="landing">
      <a className="landing-skip" href="#main">
        Skip to the content
      </a>
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner">
          <a className="landing-brand" href="/" aria-label="ClearFEA home">
            <Logo size={28} />
            <span>ClearFEA</span>
          </a>
          <nav className="landing-nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#analyses">Analyses</a>
            <a href="#verification">Verification</a>
            <a href="#open">Open source</a>
          </nav>
          <div className="landing-nav-actions">
            <button
              type="button"
              className="landing-icon-button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            <SignInLink visitor={visitor} size="small" />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero-glow" aria-hidden="true" />
          <div className="landing-container landing-hero-inner">
            <p className="landing-pill">
              <span className="landing-pill-dot" aria-hidden="true" />
              Closed beta, by invitation
            </p>
            <h1 id="hero-title" className="landing-h1">
              Finite element analysis, <span className="landing-h1-accent">in your browser</span>
            </h1>
            <p className="landing-hero-lead">
              Upload a STEP model, set up the analysis, mesh and solve it with CalculiX on a cloud machine, and take away a
              full report. Nothing to install, and every number traceable to the solver input that produced it.
            </p>
            <div className="landing-hero-actions">
              <SignInLink visitor={visitor} size="large" />
              <a className="landing-button landing-button-ghost landing-button-large" href="#verification">
                See the verification results
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            </div>
            <p className="landing-hero-note">
              <Lock size={14} aria-hidden="true" />
              For invited engineers. Sign in with the Google account your invitation was sent to.
            </p>
            <Screenshot
              hero
              light="/landing/results-light.webp"
              dark="/landing/results-dark.webp"
              alt="The ClearFEA workbench showing the von Mises stress on a cylindrical shell with a nozzle and reinforcing pad, with the model tree on the left and the run settings on the right."
            />
          </div>
        </section>

        <div className="landing-strip">
          <ul className="landing-container landing-strip-list" aria-label="At a glance">
            <li>
              <strong>CalculiX</strong> solver
            </li>
            <li>
              <strong>Gmsh</strong> meshing
            </li>
            <li>
              <strong>{summary.cases}</strong> verification cases
            </li>
            <li>
              <strong>
                {summary.checksWithin} of {summary.checks}
              </strong>{" "}
              checks within tolerance
            </li>
            <li>
              <strong>AGPL v3</strong> open source
            </li>
          </ul>
        </div>

        <Section
          id="how"
          eyebrow="How it works"
          title="From CAD file to report in four steps"
          lead="The whole workflow happens in one browser tab. The heavy work runs on a machine that starts when you need it and stops when you are done."
        >
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="landing-card landing-step">
                <div className="landing-step-head">
                  <span className="landing-step-number">{index + 1}</span>
                  <step.icon size={22} aria-hidden="true" className="landing-card-icon" />
                </div>
                <h3 className="landing-h3">{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="analyses"
          eyebrow="Analyses"
          title="The analyses a design engineer runs every week"
          lead="Linear, solid-element analysis of STEP geometry, with the loads and supports you expect."
          tinted
        >
          <div className="landing-grid-4">
            {ANALYSES.map((analysis) => (
              <article key={analysis.title} className="landing-card">
                <span className="landing-card-badge">
                  <analysis.icon size={22} aria-hidden="true" />
                </span>
                <h3 className="landing-h3">{analysis.title}</h3>
                <p>{analysis.text}</p>
              </article>
            ))}
          </div>
          <p className="landing-subhead">Loads and supports</p>
          <ul className="landing-chips" aria-label="Loads and supports">
            {LOADS.map((load) => (
              <li key={load}>{load}</li>
            ))}
          </ul>
        </Section>

        <Section
          id="results"
          eyebrow="Results"
          title="Results you can check, not just look at"
          lead="Every run keeps what produced it: the mesh, the solver, the software versions, the machine and the exact solver input. A run never changes after it is made."
        >
          <div className="landing-split">
            <ul className="landing-features">
              {RESULT_FEATURES.map((feature) => (
                <li key={feature.text}>
                  <span className="landing-feature-icon">
                    <feature.icon size={18} aria-hidden="true" />
                  </span>
                  {feature.text}
                </li>
              ))}
            </ul>
            <Screenshot
              light="/landing/mesh-light.webp"
              alt="The mesh of the shell and nozzle model with its element and node counts and the mesh settings panel."
            />
          </div>
        </Section>

        <Section
          id="verification"
          eyebrow="Verification"
          title="Checked against known answers"
          lead="Each verification case is a model with an analytical or published answer, run through the whole platform: upload, setup, meshing, CalculiX and result reading. These are some of the numbers from the latest run."
          tinted
        >
          <div className="landing-stats">
            <div className="landing-stat">
              <p className="landing-stat-value">
                {summary.checksWithin}
                <span> / {summary.checks}</span>
              </p>
              <p className="landing-stat-label">checks within tolerance, over {summary.cases} verification cases</p>
            </div>
            <div className="landing-stat">
              <p className="landing-stat-value">
                {summary.acceptanceChecksWithin}
                <span> / {summary.acceptanceChecks}</span>
              </p>
              <p className="landing-stat-label">checks within tolerance, over {summary.acceptanceCases} industrial-style acceptance cases</p>
            </div>
          </div>
          <div className="landing-table-wrap">
            <table className="landing-table">
              <caption className="landing-visually-hidden">Selected verification checks</caption>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Quantity</th>
                  <th scope="col" className="landing-num">
                    Reference
                  </th>
                  <th scope="col" className="landing-num">
                    ClearFEA
                  </th>
                  <th scope="col" className="landing-num">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {VERIFICATION_ROWS.map((row) => (
                  <tr key={row.caseName}>
                    <th scope="row">{row.caseName}</th>
                    <td className="landing-quantity">{row.label}</td>
                    <td className="landing-num" data-label="Reference">
                      {row.reference}
                    </td>
                    <td className="landing-num" data-label="ClearFEA">
                      {row.clearfea}
                    </td>
                    <td className="landing-num landing-diff" data-label="Difference">
                      {row.error}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="landing-footnote">
            The cases show how closely the software reproduces known answers, not how well a model represents its part.{" "}
            <a href={VERIFICATION_RESULTS_URL}>
              Every case, every check and its tolerance
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          </p>
        </Section>

        <Section
          id="open"
          eyebrow="Open source"
          title="Open, so you can see how every number is made"
          lead="ClearFEA is free software under the GNU Affero General Public License v3. It builds on CalculiX, Gmsh and OpenCASCADE."
        >
          <div className="landing-grid-3">
            <article className="landing-card">
              <span className="landing-card-badge">
                <Github size={22} aria-hidden="true" />
              </span>
              <h3 className="landing-h3">Read the code</h3>
              <p>The solver input generator, the result reader and the verification cases are all in the repository.</p>
              <a className="landing-card-link" href={REPOSITORY_URL}>
                Open the repository
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </article>
            <article className="landing-card">
              <span className="landing-card-badge">
                <Cpu size={22} aria-hidden="true" />
              </span>
              <h3 className="landing-h3">Run it yourself</h3>
              <p>Self-hosting on your own machine is supported and free, with the same solver and the same verification cases.</p>
              <a className="landing-card-link" href={SELF_HOSTING_URL}>
                Self-hosting guide
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </article>
            <article className="landing-card">
              <span className="landing-card-badge">
                <BookOpen size={22} aria-hidden="true" />
              </span>
              <h3 className="landing-h3">Learn the workflow</h3>
              <p>The user guide walks through a first model, from upload to report, with screenshots of each step.</p>
              <a className="landing-card-link" href={USER_GUIDE_URL}>
                Read the user guide
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </article>
          </div>
        </Section>

        <section className="landing-section" aria-labelledby="beta-title">
          <div className="landing-container">
            <div className="landing-beta">
              <div>
                <p className="landing-eyebrow">Closed beta</p>
                <h2 id="beta-title" className="landing-h2">
                  Invited engineers, real models, honest feedback
                </h2>
                <p className="landing-lead">
                  ClearFEA is open to a few invited engineers while it is shaped by their feedback. The beta is free, and
                  every run still shows its estimated time and cost before it starts.
                </p>
                <ul className="landing-checks">
                  <li>
                    <Check size={16} aria-hidden="true" />
                    Nothing to install: a browser and your Google account
                  </li>
                  <li>
                    <Check size={16} aria-hidden="true" />
                    Your models and results are yours alone, unless you share a link
                  </li>
                  <li>
                    <Check size={16} aria-hidden="true" />
                    New features and fixes arrive without you doing anything
                  </li>
                </ul>
              </div>
              <div className="landing-beta-action">
                <SignInLink visitor={visitor} size="large" />
                <p>Not invited yet? Ask the person who told you about ClearFEA.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/" aria-label="ClearFEA home">
              <Logo size={24} />
              <span>ClearFEA</span>
            </a>
            <p>
              A general-purpose analysis tool. It does not certify designs or check compliance with any code or standard;
              engineering decisions remain with a qualified engineer.
            </p>
          </div>
          <nav className="landing-footer-links" aria-label="Links">
            <a href={REPOSITORY_URL}>Source code (AGPL v3)</a>
            <a href={USER_GUIDE_URL}>User guide</a>
            <a href={VERIFICATION_RESULTS_URL}>Verification results</a>
            <a href={SELF_HOSTING_URL}>Self-hosting</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
