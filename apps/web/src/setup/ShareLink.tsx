// SPDX-License-Identifier: AGPL-3.0-or-later
// A succeeded run's read-only share link (M8.7, ADR-083), in the Run panel. The owner makes a
// link, copies it while it is shown, and revokes it; only a hash of the link is stored, so an
// earlier link cannot be shown again, and making a new one stops it.

import type { ShareLinkView } from "@clearfea/spec";
import { useEffect, useState } from "react";
import { getShareLink, makeShareLink, revokeShareLink, shareUrl } from "../api/shareLinks";

/** An API timestamp as a fixed, unambiguous UTC time, as the run record shows it. */
function utc(timestamp: string): string {
  return `${timestamp.slice(0, 19).replace("T", " ")} UTC`;
}

type State =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "active"; share: ShareLinkView; url: string | null }
  | { kind: "failed"; problem: string };

export function ShareLink({ runId, onSignedOut }: { runId: string; onSignedOut: (problem: string) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;
    void getShareLink(runId).then((reply) => {
      if (!current) return;
      if (reply.kind === "signedOut") return onSignedOut(reply.problem);
      if (reply.kind === "error") return setState({ kind: "failed", problem: reply.problem });
      setState(reply.value === null ? { kind: "none" } : { kind: "active", share: reply.value, url: null });
    });
    return () => {
      current = false;
    };
  }, [runId, onSignedOut]);

  async function make() {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    const reply = await makeShareLink(runId);
    setBusy(false);
    if (reply.kind === "signedOut") return onSignedOut(reply.problem);
    if (reply.kind === "error") return setProblem(reply.problem);
    setState({ kind: "active", share: reply.value.share, url: shareUrl(reply.value.token) });
  }

  async function revoke() {
    setBusy(true);
    setProblem(null);
    const reply = await revokeShareLink(runId);
    setBusy(false);
    if (reply.kind === "signedOut") return onSignedOut(reply.problem);
    if (reply.kind === "error") return setProblem(reply.problem);
    setState({ kind: "none" });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setProblem("The browser did not allow copying. Select the link and copy it yourself.");
    }
  }

  return (
    <section aria-label="Share">
      <h3 className="pane-subtitle">Share</h3>
      {state.kind === "loading" && <p className="field-hint">Checking for a share link…</p>}
      {state.kind === "failed" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "none" && (
        <>
          <p className="field-hint">
            A read-only link shows this run's results to anyone who has it, without signing in. They cannot change
            anything or see the rest of your account.
          </p>
          <button type="button" onClick={() => void make()} disabled={busy}>
            Make a read-only link
          </button>
        </>
      )}
      {state.kind === "active" && (
        <>
          {state.url !== null ? (
            <>
              <label className="share-link">
                Read-only link
                <input type="text" readOnly value={state.url} onFocus={(event) => event.target.select()} />
              </label>
              <p className="field-hint">
                Copy it now: it is shown only once. Anyone with it can see this run's results until you revoke it.
              </p>
            </>
          ) : (
            <p className="field-hint">
              A read-only link made {utc(state.share.createdAt)} is active. It is shown only when it is made; make a
              new link to copy one again, which stops this one.
            </p>
          )}
          <div className="export-buttons">
            {state.url !== null && (
              <button type="button" onClick={() => void copy(state.url as string)} disabled={busy}>
                {copied ? "Copied" : "Copy the link"}
              </button>
            )}
            {state.url === null && (
              <button type="button" onClick={() => void make()} disabled={busy}>
                Make a new link
              </button>
            )}
            <button type="button" onClick={() => void revoke()} disabled={busy}>
              Revoke the link
            </button>
          </div>
        </>
      )}
      {problem !== null && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
