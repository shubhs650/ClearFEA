# SPDX-License-Identifier: AGPL-3.0-or-later
"""Worker settings, read from environment variables."""

import os
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
    )
