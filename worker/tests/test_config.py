# SPDX-License-Identifier: AGPL-3.0-or-later
import pytest

from clearfea_worker.config import ConfigError, load_settings


def test_reads_settings_from_the_environment() -> None:
    settings = load_settings(
        {
            "CLEARFEA_WORKER_TOKEN": "secret",
            "CLEARFEA_API_URL": "http://host.docker.internal:8787/",
            "CLEARFEA_WORKER_ID": "worker-a",
            "CLEARFEA_POLL_SECONDS": "0.5",
        }
    )
    assert settings.api_url == "http://host.docker.internal:8787"
    assert settings.worker_id == "worker-a"
    assert settings.poll_seconds == 0.5
    assert settings.heartbeat_seconds == 5.0


def test_missing_token_says_where_to_find_it() -> None:
    with pytest.raises(ConfigError, match=r"apps/api/\.dev\.vars"):
        load_settings({})


def test_rejects_a_non_positive_interval() -> None:
    with pytest.raises(ConfigError, match="CLEARFEA_POLL_SECONDS"):
        load_settings({"CLEARFEA_WORKER_TOKEN": "x", "CLEARFEA_POLL_SECONDS": "0"})
