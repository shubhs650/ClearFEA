// SPDX-License-Identifier: AGPL-3.0-or-later
// The facts the landing page states (M10.4). The verification numbers are copied from
// docs/VERIFICATION_RESULTS.md, and test/landing.test.tsx checks every one of them against that
// file, so a rebuilt results page that changes a number fails the fast tier until this is updated.

export const REPOSITORY_URL = "https://github.com/shubhs650/ClearFEA";
export const VERIFICATION_RESULTS_URL = `${REPOSITORY_URL}/blob/main/docs/VERIFICATION_RESULTS.md`;
export const USER_GUIDE_URL = `${REPOSITORY_URL}/blob/main/docs/USER_GUIDE.md`;
export const SELF_HOSTING_URL = `${REPOSITORY_URL}/blob/main/docs/SELF_HOSTING.md`;

/** The verification summary: the cases of the last phase-end run and the acceptance cases. */
export const VERIFICATION_SUMMARY = {
  cases: 27,
  checks: 314,
  checksWithin: 314,
  acceptanceCases: 2,
  acceptanceChecks: 34,
  acceptanceChecksWithin: 34,
};

export interface VerificationRow {
  /** The case as docs/VERIFICATION_RESULTS.md names it, "V-01 Thick cylinder, internal pressure". */
  readonly caseName: string;
  /** The check's name exactly as the results page writes it. */
  readonly check: string;
  /** A shorter name for the page. */
  readonly label: string;
  readonly reference: string;
  readonly clearfea: string;
  readonly error: string;
}

/** A few checks, one per kind of analysis, shown as they appear on the results page. */
export const VERIFICATION_ROWS: readonly VerificationRow[] = [
  {
    caseName: "V-01 Thick cylinder, internal pressure",
    check: "Hoop-dominated von Mises stress at the bore",
    label: "Von Mises stress at the bore",
    reference: "32.187 MPa",
    clearfea: "32.06 MPa",
    error: "-0.39 %",
  },
  {
    caseName: "V-02 Cantilever, end load",
    check: "Tip deflection (mean over the free end)",
    label: "Tip deflection",
    reference: "-0.064313 in",
    clearfea: "-0.063851 in",
    error: "-0.72 %",
  },
  {
    caseName: "V-06 Thin rotating ring",
    check: "Hoop stress inside, r = a",
    label: "Hoop stress inside",
    reference: "83.223 MPa",
    clearfea: "83.221 MPa",
    error: "-0.00 %",
  },
  {
    caseName: "V-13 Plane wall conduction",
    check: "Halfway through, the mean of Th and Tc",
    label: "Temperature halfway through",
    reference: "84.444 °C",
    clearfea: "84.444 °C",
    error: "-0.00 %",
  },
  {
    caseName: "V-18 Thick cylinder thermal stress",
    check: "Hoop stress at the bore, σθ(a)",
    label: "Hoop stress at the bore",
    reference: "-233.22 MPa",
    clearfea: "-233.12 MPa",
    error: "-0.04 %",
  },
  {
    caseName: "V-20 Cantilever beam frequencies",
    check: "First bending mode in z, βL = 1.8751",
    label: "First bending frequency",
    reference: "10.192 Hz",
    clearfea: "10.202 Hz",
    error: "+0.0920 %",
  },
];
