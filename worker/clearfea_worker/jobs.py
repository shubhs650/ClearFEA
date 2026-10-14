# SPDX-License-Identifier: AGPL-3.0-or-later
"""Job handlers, one per job type. Real job types arrive from M1 onwards."""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .api import ClaimedJob


@dataclass
class JobContext:
    """What a handler may use while it runs."""

    stage: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)

    def set_stage(self, stage: str) -> None:
        self.stage = stage


Handler = Callable[[ClaimedJob, JobContext], dict[str, Any]]


def run_noop(job: ClaimedJob, context: JobContext) -> dict[str, Any]:
    """Does nothing. Exists to prove the claim, heartbeat and completion path."""
    context.set_stage("noop")
    return {"message": "No-op job completed."}


HANDLERS: dict[str, Handler] = {
    "noop": run_noop,
}
