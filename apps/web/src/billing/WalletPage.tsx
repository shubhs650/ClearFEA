// SPDX-License-Identifier: AGPL-3.0-or-later
// The wallet page (M8.1, ADR-080): the balance, what was granted and charged, and every ledger
// entry with the run or mesh it paid for. Drawn over the workbench, which stays as it was. In
// self-hosting mode (M8.10, ADR-084) it says that the wallet is information only. Since M8.6
// (ADR-086) it shows storage too, with the daily storage charges in the ledger. During the closed
// beta on the solver host (M12.4, ADR-106 item 6) it shows usage only: no balance, no grants.

import type { WalletEntry, WalletResponse, WalletView } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { fetchWallet } from "../api/wallet";
import { bytes } from "./bytes";
import { credits } from "./credits";
import { StorageSection } from "./StorageSection";

type WalletState = { kind: "loading" } | { kind: "loaded"; wallet: WalletResponse } | { kind: "problem"; problem: string };

export function WalletPage({ onClose, onSignedOut }: { onClose: () => void; onSignedOut: (notice?: string) => void }) {
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  const [refreshed, setRefreshed] = useState(0);

  const load = useCallback(async () => {
    setState((was) => (was.kind === "loaded" ? was : { kind: "loading" }));
    const result = await fetchWallet();
    if (result.kind === "signedOut") onSignedOut(result.problem);
    else if (result.kind === "error") setState({ kind: "problem", problem: result.problem });
    else setState({ kind: "loaded", wallet: result.value });
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="pane wallet-page" aria-label="Wallet">
      <header className="wallet-header">
        <h2 className="wallet-title">Wallet</h2>
        <button
          type="button"
          onClick={() => {
            setRefreshed((n) => n + 1);
            void load();
          }}
        >
          Refresh
        </button>
        <button type="button" onClick={onClose}>
          Back to the workbench
        </button>
      </header>
      {state.kind === "loading" && <p className="pane-empty">Loading the wallet…</p>}
      {state.kind === "problem" && (
        <p className="form-problem" role="alert">
          {state.problem}
        </p>
      )}
      {state.kind === "loaded" &&
        (state.wallet.usageOnly ? (
          <UsageContent wallet={state.wallet.wallet} />
        ) : (
          <WalletContent wallet={state.wallet.wallet} selfHosted={state.wallet.selfHosted} />
        ))}
      <StorageSection refresh={refreshed} onSignedOut={onSignedOut} />
    </section>
  );
}

function WalletContent({ wallet, selfHosted }: { wallet: WalletView; selfHosted: boolean }) {
  return (
    <>
      <dl className="wallet-totals">
        <div>
          <dt>Balance</dt>
          <dd className="wallet-balance" data-testid="wallet-balance">
            {credits(wallet.balance)}
          </dd>
        </div>
        <div>
          <dt>Granted</dt>
          <dd>{credits(wallet.granted)}</dd>
        </div>
        <div>
          <dt>Charged</dt>
          <dd>{credits(-wallet.charged)}</dd>
        </div>
      </dl>
      {selfHosted ? (
        <p className="wallet-note" data-testid="wallet-self-hosted">
          Self-hosted: this wallet is information only. Meshing and solving are counted per started second on the
          machine, at the rate of the machine size the job was queued on, so you can see what the work would cost
          on the hosted service. Importing is free, reusing a mesh is free, and a job that stops because of a fault
          in ClearFEA is not counted. Nothing is refused when the balance runs out, and it can go below zero.
        </p>
      ) : (
        <p className="wallet-note">
          Play money: Phase 0 has no payments. Meshing and solving are charged per started second on the machine,
          at the rate of the machine size the job was queued on. Importing is free, reusing a mesh is free, and a
          job that stops because of a fault in ClearFEA is not charged. A run is refused when its estimate is more
          than the balance.
        </p>
      )}
      {wallet.entries.length === 0 ? (
        <p className="pane-empty">No entries yet.</p>
      ) : (
        <table className="wallet-table" aria-label="Ledger">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>What</th>
              <th>Machine size</th>
              <th className="wallet-number">Billed time</th>
              <th className="wallet-number">Amount</th>
              <th className="wallet-number">Balance</th>
            </tr>
          </thead>
          <tbody>
            {wallet.entries.map((entry) => (
              <tr key={entry.seq}>
                <td>{utc(entry.createdAt)}</td>
                <td>{what(entry)}</td>
                <td>{entry.job === null ? "" : `${entry.job.machineSize}, ${credits(entry.job.ratePerHour)} per hour`}</td>
                <td className="wallet-number">
                  {entry.job === null ? "" : `${entry.job.billedSeconds.toLocaleString("en-US")} s`}
                </td>
                <td className="wallet-number">{credits(entry.amount)}</td>
                <td className="wallet-number">{credits(entry.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** What the user's work used, without a balance (ADR-106 item 6). */
function UsageContent({ wallet }: { wallet: WalletView }) {
  const used = wallet.entries.filter((entry) => entry.amount < 0);
  const seconds = used.reduce((sum, entry) => sum + (entry.job?.billedSeconds ?? 0), 0);
  return (
    <>
      <dl className="wallet-totals">
        <div>
          <dt>Used</dt>
          <dd className="wallet-balance" data-testid="wallet-used">
            {credits(-wallet.charged)}
          </dd>
        </div>
        <div>
          <dt>Machine time</dt>
          <dd>{seconds.toLocaleString("en-US")} s</dd>
        </div>
      </dl>
      <p className="wallet-note" data-testid="wallet-usage-only">
        Closed beta: this page shows what your work used, and nothing is refused for it. Meshing and solving are
        counted per started second on the solver, at the rate of the machine size the job was queued on, and
        storage over the free allowance per day. Importing is free, reusing a mesh is free, and a job that stops
        because of a fault in ClearFEA is not counted.
      </p>
      {used.length === 0 ? (
        <p className="pane-empty">Nothing used yet.</p>
      ) : (
        <table className="wallet-table" aria-label="Usage">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>What</th>
              <th>Machine size</th>
              <th className="wallet-number">Billed time</th>
              <th className="wallet-number">Used</th>
            </tr>
          </thead>
          <tbody>
            {used.map((entry) => (
              <tr key={entry.seq}>
                <td>{utc(entry.createdAt)}</td>
                <td>{what(entry)}</td>
                <td>{entry.job === null ? "" : `${entry.job.machineSize}, ${credits(entry.job.ratePerHour)} per hour`}</td>
                <td className="wallet-number">
                  {entry.job === null ? "" : `${entry.job.billedSeconds.toLocaleString("en-US")} s`}
                </td>
                <td className="wallet-number">{credits(-entry.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const RUN_STATUS = {
  solving: "solving",
  succeeded: "solved",
  failed: "failed",
  cancelled: "cancelled",
  stopped: "stopped at its limit",
} as const;

/** What an entry paid for, in a few words. */
function what(entry: WalletEntry): string {
  if (entry.reason === "grant") return "Credit grant";
  if (entry.storage !== null) {
    const above = Math.max(0, entry.storage.usedBytes - entry.storage.freeBytes);
    return `Storage on ${entry.storage.day}: ${bytes(above)} above the ${bytes(entry.storage.freeBytes)} free allowance (${bytes(entry.storage.usedBytes)} stored)`;
  }
  if (entry.run !== null) {
    return `Run of “${entry.run.simulationName}”, started ${utc(entry.run.startedAt)} UTC (${RUN_STATUS[entry.run.status]})`;
  }
  if (entry.mesh !== null) {
    const elements = entry.mesh.elements === null ? "failed" : `${entry.mesh.elements.toLocaleString("en-US")} elements`;
    return `Mesh of ${entry.mesh.geometryName} (${elements})`;
  }
  return entry.reason === "solve" ? "Run" : entry.reason === "storage" ? "Storage" : "Mesh";
}

/** An API timestamp as a fixed, unambiguous UTC time, as the run record writes it. */
function utc(timestamp: string): string {
  return timestamp.slice(0, 19).replace("T", " ");
}
