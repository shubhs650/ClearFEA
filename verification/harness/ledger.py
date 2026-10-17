# SPDX-License-Identifier: AGPL-3.0-or-later
"""The M8 exit check: the harness user's ledger reconciles exactly over the whole suite.

Pure: takes the wallet (GET /api/wallet) and the cost each run the suite made recorded, and
says which of the reconciliation checks hold. Money is whole micro-credits (ADR-080), so every
comparison is exact. Everything comes through the API: a second process reading the API's local
SQLite file locks it, and the API then fails with SQLITE_BUSY.
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


def cost_of(seconds: int, rate_per_hour: int) -> int:
    """Seconds times the hourly rate over 3600, rounded to the nearest micro-credit, halves up
    (apps/api/src/billing/cost.ts)."""
    return (seconds * rate_per_hour + 1800) // 3600


def entries_for_run(wallet: dict[str, Any], run_id: str) -> list[dict[str, Any]]:
    """The wallet's ledger entries that paid for one run."""
    return [e for e in wallet["entries"] if e["run"] is not None and e["run"]["id"] == run_id]


def reconcile(wallet: dict[str, Any], runs: dict[str, dict[str, Any]]) -> list[Reconciliation]:
    """`wallet`: GET /api/wallet's wallet (balance, granted, charged, entries newest first).
    `runs`: run id -> the run's recorded cost (billedSeconds, amount, charged), for every run
    the suite made."""
    entries = sorted(wallet["entries"], key=lambda e: e["seq"])
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

    # Every job charge is its billed seconds at its rate, as the platform prices a job.
    jobs = [e for e in entries if e["job"] is not None]
    priced = sum(cost_of(e["job"]["billedSeconds"], e["job"]["ratePerHour"]) for e in jobs)
    wrong = [
        f"entry {e['seq']}: {-e['amount']} for {e['job']['billedSeconds']} s at "
        f"{e['job']['ratePerHour']} per hour"
        for e in jobs
        if -e["amount"] != cost_of(e["job"]["billedSeconds"], e["job"]["ratePerHour"])
    ]
    out.append(
        Reconciliation(
            "Each job charge is its billed seconds at its rate",
            f"{len(jobs)} jobs, {_credits(priced)}",
            "; ".join(wrong[:3]) or f"{_credits(-sum(e['amount'] for e in jobs))}",
            not wrong,
        )
    )

    # Every charged run has one entry for exactly the cost its record shows.
    wrong = []
    for rid, cost in runs.items():
        paid = [-e["amount"] for e in entries_for_run(wallet, rid)]
        if paid != ([cost["amount"]] if cost["charged"] else []):
            wrong.append(f"run {rid}: cost {cost['amount']}, ledger {paid or 'none'}")
    out.append(
        Reconciliation(
            "Each charged run has one entry for exactly its recorded cost",
            f"{len(runs)} runs, {_credits(sum(c['amount'] for c in runs.values()))}",
            "; ".join(wrong[:3]) or f"{len(runs)} runs matched",
            not wrong,
        )
    )

    # Nothing else moved the balance: only the seeded grant has no job (the sweep never runs).
    other = [e for e in entries if e["job"] is None and e["reason"] != "grant"]
    out.append(
        Reconciliation(
            "No entry without a job other than the grant",
            "none",
            ", ".join(f"{e['reason']} {e['amount']}" for e in other[:3]) or "none",
            not other,
        )
    )
    return out
