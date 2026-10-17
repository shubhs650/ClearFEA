# SPDX-License-Identifier: AGPL-3.0-or-later
"""The M8 exit check: the harness user's ledger reconciles exactly over the whole suite.

Pure: takes the rows `make verify` read from the API's local database and its wallet view, and
says which of the reconciliation checks hold. Money is whole micro-credits (ADR-080), so every
comparison is exact.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Reconciliation:
    check: str
    expected: str
    found: str
    ok: bool


def _credits(micro: int) -> str:
    return f"{micro / 1_000_000:.6f} credits"


def reconcile(
    entries: list[dict[str, Any]], jobs: list[dict[str, Any]], wallet: dict[str, Any]
) -> list[Reconciliation]:
    """`entries`: the user's ledger_entries rows (seq, amount, balance, reason, job_id), in seq
    order. `jobs`: the user's metered jobs (id, cost), every job with a cost recorded. `wallet`:
    GET /api/wallet (balance, granted, charged)."""
    out: list[Reconciliation] = []

    # Each entry's balance is the one before it plus its amount, from zero.
    running, breaks = 0, []
    for e in entries:
        running += e["amount"]
        if e["balance"] != running:
            breaks.append(f"entry {e['seq']} says {e['balance']}, sum is {running}")
            running = e["balance"]
    out.append(
        Reconciliation(
            "Every running balance is the previous one plus the entry",
            f"{len(entries)} entries chained",
            "; ".join(breaks[:3]) or f"{len(entries)} entries chained",
            not breaks,
        )
    )

    total = sum(e["amount"] for e in entries)
    out.append(
        Reconciliation(
            "Wallet balance equals the sum of the ledger",
            _credits(total),
            _credits(wallet["balance"]),
            wallet["balance"] == total and wallet["granted"] + wallet["charged"] == total,
        )
    )

    # Every charged job has exactly one entry for its cost, and every job entry is one of them.
    by_job = {e["job_id"]: e for e in entries if e["job_id"] is not None}
    charged = {j["id"]: j["cost"] for j in jobs if j["cost"]}
    wrong = [
        f"job {jid}: cost {cost}, ledger {by_job[jid]['amount'] if jid in by_job else 'none'}"
        for jid, cost in charged.items()
        if jid not in by_job or by_job[jid]["amount"] != -cost
    ]
    wrong += [
        f"entry {e['seq']} for job {jid} that cost nothing"
        for jid, e in by_job.items()
        if jid not in charged
    ]
    paid = -sum(e["amount"] for e in by_job.values())
    out.append(
        Reconciliation(
            "Each charged job has one entry for exactly its cost",
            f"{len(charged)} jobs, {_credits(sum(charged.values()))}",
            "; ".join(wrong[:3]) or f"{len(by_job)} entries, {_credits(paid)}",
            not wrong,
        )
    )

    # Nothing else moved the balance: only the seeded grant has no job (the sweep never runs).
    other = [e for e in entries if e["job_id"] is None and e["reason"] != "grant"]
    out.append(
        Reconciliation(
            "No entry without a job other than the grant",
            "none",
            ", ".join(f"{e['reason']} {e['amount']}" for e in other[:3]) or "none",
            not other,
        )
    )
    return out
