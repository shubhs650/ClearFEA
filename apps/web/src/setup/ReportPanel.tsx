// SPDX-License-Identifier: AGPL-3.0-or-later
// The Report panel (M7.1, ADR-074): which sections the report prints, the saved views it draws as
// result plots, the title block, the unit system it prints in (M7.6, ADR-076), and the user's
// company name and logo. Options are saved per simulation, the company name and logo once per user.
// Below them, the report's figures are drawn for the latest solved run (M7.2). Generating the
// report comes with M7.3.

import {
  type ReportBranding,
  type ReportOptions,
  type ReportSection,
  ReportSectionValues,
  type RunView,
  type SavedView,
  type TitleBlock,
  reportSectionLabels,
} from "@clearfea/spec";
import { useEffect, useId, useState } from "react";
import {
  deleteLogo,
  fetchBranding,
  fetchReportOptions,
  logoPath,
  saveCompanyName,
  saveReportOptions,
  uploadLogo,
} from "../api/report";
import type { ApiResult } from "../api/request";
import { UNIT_SYSTEMS } from "../units/system";
import { Notes } from "./ItemPanels";
import { ReportFigures } from "./ReportFigures";
import type { ItemStatus } from "./spec";
import { useViews } from "./useViews";

const titleFields: { field: keyof TitleBlock; label: string }[] = [
  { field: "title", label: "Report title" },
  { field: "documentNumber", label: "Document number" },
  { field: "revision", label: "Revision" },
  { field: "preparedBy", label: "Prepared by" },
  { field: "checkedBy", label: "Checked by" },
  { field: "approvedBy", label: "Approved by" },
];

type Loaded = { kind: "loading" } | { kind: "failed"; problem: string } | { kind: "ok"; options: ReportOptions; branding: ReportBranding };

type Outcome = { kind: "ok"; message: string } | { kind: "failed"; problem: string } | null;

function PlainField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} maxLength={200} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

/** The unit system the report prints every value in (M7.6, ADR-076). */
function ReportUnitsField({ value, onChange }: { value: string; onChange: (unitSystem: string) => void }) {
  const id = useId();
  return (
    <fieldset className="setup-bodies">
      <legend>Units</legend>
      <div className="field">
        <label htmlFor={id}>Report unit system</label>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {UNIT_SYSTEMS.map((system) => (
            <option key={system.id} value={system.id}>
              {system.name}
            </option>
          ))}
        </select>
      </div>
      <span className="field-hint">
        Every value in the report prints in this system, whatever units the results are shown in here. Setup values typed in
        another unit also print as entered.
      </span>
    </fieldset>
  );
}

function viewLabel(view: SavedView): string {
  return view.settings.result === null ? `${view.name} (geometry)` : view.name;
}

export function ReportPanel({
  simulationId,
  status,
  run,
  geometryId,
  units,
  onSignedOut,
}: {
  simulationId: string;
  status: ItemStatus | undefined;
  /** The simulation's latest run, whose figures the panel draws once it has succeeded. */
  run: RunView | null;
  geometryId: string | null;
  /** Display units of the result quantities, for the figures' legends. */
  units: Readonly<Record<string, string>>;
  onSignedOut: (problem: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [options, setOptions] = useState<ReportOptions | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoOutcome, setLogoOutcome] = useState<Outcome>(null);
  const views = useViews(simulationId, onSignedOut);

  useEffect(() => {
    let current = true;
    setLoaded({ kind: "loading" });
    Promise.all([fetchReportOptions(simulationId), fetchBranding()]).then(([optionsResult, brandingResult]) => {
      if (!current) return;
      if (optionsResult.kind === "ok" && brandingResult.kind === "ok") {
        setLoaded({ kind: "ok", options: optionsResult.value.options, branding: brandingResult.value });
        setOptions(optionsResult.value.options);
        setCompanyName(brandingResult.value.companyName);
        return;
      }
      const failed = optionsResult.kind !== "ok" ? optionsResult : brandingResult;
      if (failed.kind === "signedOut") onSignedOut(failed.problem);
      setLoaded({
        kind: "failed",
        problem: `The report options could not be loaded: ${failed.kind === "ok" ? "" : failed.problem}`,
      });
    });
    return () => {
      current = false;
    };
  }, [simulationId, onSignedOut]);

  function failure(result: ApiResult<unknown>, what: string): Outcome {
    if (result.kind === "signedOut") onSignedOut(result.problem);
    return { kind: "failed", problem: `${what}: ${result.kind === "ok" ? "" : result.problem}` };
  }

  if (loaded.kind !== "ok" || options === null) {
    return (
      <section className="setup-panel" aria-label="Report">
        <h2 className="pane-title">Report</h2>
        {loaded.kind === "failed" ? (
          <p className="form-problem" role="alert">
            {loaded.problem}
          </p>
        ) : (
          <p className="pane-empty">Loading the report options…</p>
        )}
      </section>
    );
  }

  const { branding } = loaded;
  const changed =
    JSON.stringify(options) !== JSON.stringify(loaded.options) || companyName !== branding.companyName;

  function edit(next: ReportOptions) {
    setOptions(next);
    setOutcome(null);
  }

  function toggleSection(section: ReportSection, on: boolean) {
    if (options === null) return;
    const chosen = new Set(options.sections);
    if (on) chosen.add(section);
    else chosen.delete(section);
    edit({ ...options, sections: ReportSectionValues.filter((s) => chosen.has(s)) });
  }

  function toggleView(id: string, on: boolean) {
    if (options === null) return;
    const rest = options.views.filter((v) => v !== id);
    edit({ ...options, views: on ? [...rest, id] : rest });
  }

  async function save() {
    if (options === null) return;
    setSaving(true);
    const [optionsResult, brandingResult] = await Promise.all([
      saveReportOptions(simulationId, options),
      companyName === branding.companyName ? Promise.resolve(null) : saveCompanyName(companyName),
    ]);
    setSaving(false);
    if (optionsResult.kind !== "ok") return setOutcome(failure(optionsResult, "The report options were not saved"));
    if (brandingResult !== null && brandingResult.kind !== "ok") {
      return setOutcome(failure(brandingResult, "The company name was not saved"));
    }
    const nextBranding = brandingResult === null ? branding : brandingResult.value;
    setLoaded({ kind: "ok", options: optionsResult.value.options, branding: nextBranding });
    setOptions(optionsResult.value.options);
    setCompanyName(nextBranding.companyName);
    setOutcome({ kind: "ok", message: "Report options saved." });
  }

  async function logo(action: () => Promise<ApiResult<ReportBranding>>, what: string, done: string) {
    setLogoBusy(true);
    const result = await action();
    setLogoBusy(false);
    if (result.kind !== "ok") return setLogoOutcome(failure(result, what));
    setLoaded((now) => (now.kind === "ok" ? { ...now, branding: { ...now.branding, logo: result.value.logo } } : now));
    setLogoOutcome({ kind: "ok", message: done });
  }

  const viewList = views.list;
  const byId = new Map(viewList.kind === "ok" ? viewList.views.map((v) => [v.id, v]) : []);
  const resultsOn = options.sections.includes("results");

  return (
    <section className="setup-panel" aria-label="Report">
      <h2 className="pane-title">Report</h2>
      <Notes status={status} />
      <fieldset className="setup-bodies">
        <legend>Sections</legend>
        {ReportSectionValues.map((section) => (
          <label key={section} className="checkbox">
            <input
              type="checkbox"
              checked={options.sections.includes(section)}
              onChange={(event) => toggleSection(section, event.target.checked)}
            />
            {reportSectionLabels[section]}
          </label>
        ))}
        <span className="field-hint">
          Sections print in this order. The tool's standing statements, versions and verification link are always printed.
        </span>
      </fieldset>
      <fieldset className="setup-bodies" disabled={!resultsOn}>
        <legend>Saved views for the result plots</legend>
        {viewList.kind === "loading" && <span className="field-hint">Loading the saved views…</span>}
        {viewList.kind === "failed" && (
          <span className="form-problem" role="alert">
            {viewList.problem}
          </span>
        )}
        {viewList.kind === "ok" && viewList.views.length === 0 && (
          <span className="field-hint">
            No saved views yet. Save views of the results in the viewer's Views menu, then pick them here.
          </span>
        )}
        {viewList.kind === "ok" &&
          viewList.views.map((view) => (
            <label key={view.id} className="checkbox">
              <input
                type="checkbox"
                checked={options.views.includes(view.id)}
                onChange={(event) => toggleView(view.id, event.target.checked)}
              />
              {viewLabel(view)}
            </label>
          ))}
        {options.views.length > 0 && (
          <span className="field-hint">
            Drawn in the order picked: {options.views.map((id) => byId.get(id)?.name ?? "…").join(", ")}.
          </span>
        )}
        {!resultsOn && <span className="field-hint">Turn on Result plots to pick views.</span>}
      </fieldset>
      <fieldset className="setup-bodies">
        <legend>Title block</legend>
        {titleFields.map(({ field, label }) => (
          <PlainField
            key={field}
            label={label}
            value={options.titleBlock[field]}
            onChange={(value) => edit({ ...options, titleBlock: { ...options.titleBlock, [field]: value } })}
          />
        ))}
      </fieldset>
      <ReportUnitsField value={options.unitSystem} onChange={(unitSystem) => edit({ ...options, unitSystem })} />
      <fieldset className="setup-bodies">
        <legend>Company</legend>
        <PlainField
          label="Company name"
          value={companyName}
          onChange={(value) => {
            setCompanyName(value);
            setOutcome(null);
          }}
        />
        <span className="field-hint">The company name and logo are yours: every report you make carries them.</span>
        <div className="field">
          <span>Logo</span>
          {branding.logo === null ? (
            <span className="field-hint">No logo. A PNG or JPEG of at most 1 MB.</span>
          ) : (
            <>
              <img className="report-logo" src={logoPath(branding.logo.updatedAt)} alt="Your logo" />
              <span className="field-hint">
                {branding.logo.contentType === "image/png" ? "PNG" : "JPEG"}, {branding.logo.width} × {branding.logo.height}{" "}
                pixels
              </span>
            </>
          )}
          <div className="field-actions">
            <label className="file-button">
              <span>{branding.logo === null ? "Upload a logo" : "Replace the logo"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={logoBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void logo(() => uploadLogo(file), "The logo was not uploaded", "Logo uploaded.");
                }}
              />
            </label>
            {branding.logo !== null && (
              <button
                type="button"
                disabled={logoBusy}
                onClick={() => void logo(deleteLogo, "The logo was not removed", "Logo removed.")}
              >
                Remove the logo
              </button>
            )}
          </div>
          {logoOutcome && (
            <span
              className={logoOutcome.kind === "ok" ? "field-hint" : "form-problem"}
              role={logoOutcome.kind === "ok" ? "status" : "alert"}
            >
              {logoOutcome.kind === "ok" ? logoOutcome.message : logoOutcome.problem}
            </span>
          )}
        </div>
      </fieldset>
      <div className="field-actions">
        <button type="button" onClick={() => void save()} disabled={saving || !changed}>
          Save report options
        </button>
      </div>
      {outcome && (
        <p className={outcome.kind === "ok" ? "field-hint" : "form-problem"} role={outcome.kind === "ok" ? "status" : "alert"}>
          {outcome.kind === "ok" ? outcome.message : outcome.problem}
        </p>
      )}
      {changed && outcome === null && <p className="field-hint">Unsaved changes.</p>}
      <ReportFigures
        run={run}
        geometryId={geometryId}
        options={loaded.options}
        views={viewList.kind === "ok" ? viewList.views : null}
        unsaved={changed}
        units={units}
        onSignedOut={onSignedOut}
      />
    </section>
  );
}
