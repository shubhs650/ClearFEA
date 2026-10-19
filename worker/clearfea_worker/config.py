# SPDX-License-Identifier: AGPL-3.0-or-later
"""Worker settings, read from environment variables."""

import os
import re
import socket
from collections.abc import Mapping
from dataclasses import dataclass


class ConfigError(Exception):
    """A required setting is missing or malformed."""


@dataclass(frozen=True)
class Settings:
    api_url: str
    worker_token: str
    worker_id: str
    poll_seconds: float = 2.0
    heartbeat_seconds: float = 5.0
    #: The machine size this worker runs on, a name from the API's machine_sizes (M10.6, ADR-099).
    #: It claims only that size's jobs. None, the local default, claims every size's jobs.
    machine_size: str | None = None
    #: Exits after this long without a job (ADR-095 item 7). None keeps polling for ever.
    idle_exit_seconds: float | None = None
    #: Claims no new job once it has been up this long, so it exits after the job it holds.
    #: None has no limit.
    max_lifetime_seconds: float | None = None


#: A machine size name as the API writes them, such as medium or large.
_SIZE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


def _seconds(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number of seconds, got {raw!r}.") from None
    if value <= 0:
        raise ConfigError(f"{name} must be greater than zero, got {raw!r}.")
    return value


def _optional_seconds(env: Mapping[str, str], name: str) -> float | None:
    if env.get(name) in (None, ""):
        return None
    return _seconds(env, name, 0.0)


def _machine_size(env: Mapping[str, str]) -> str | None:
    raw = env.get("CLEARFEA_MACHINE_SIZE", "").strip()
    if raw == "":
        return None
    if not _SIZE_NAME.match(raw):
        raise ConfigError(
            "CLEARFEA_MACHINE_SIZE must be a machine size name such as medium or large, "
            f"got {raw!r}."
        )
    return raw


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    token = env.get("CLEARFEA_WORKER_TOKEN", "")
    if not token:
        raise ConfigError(
            "CLEARFEA_WORKER_TOKEN is not set. Set it to the WORKER_TOKEN value in "
            "apps/api/.dev.vars."
        )
    return Settings(
        api_url=env.get("CLEARFEA_API_URL", "http://127.0.0.1:8787").rstrip("/"),
        worker_token=token,
        worker_id=env.get("CLEARFEA_WORKER_ID") or socket.gethostname(),
        poll_seconds=_seconds(env, "CLEARFEA_POLL_SECONDS", 2.0),
        heartbeat_seconds=_seconds(env, "CLEARFEA_HEARTBEAT_SECONDS", 5.0),
        machine_size=_machine_size(env),
        idle_exit_seconds=_optional_seconds(env, "CLEARFEA_IDLE_EXIT_SECONDS"),
        max_lifetime_seconds=_optional_seconds(env, "CLEARFEA_MAX_LIFETIME_SECONDS"),
    )
