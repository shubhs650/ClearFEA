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


def test_reads_the_cloud_machine_settings() -> None:
    settings = load_settings(
        {
            "CLEARFEA_WORKER_TOKEN": "x",
            "CLEARFEA_MACHINE_SIZE": "large",
            "CLEARFEA_IDLE_EXIT_SECONDS": "600",
            "CLEARFEA_MAX_LIFETIME_SECONDS": "43200",
        }
    )
    assert settings.machine_size == "large"
    assert settings.idle_exit_seconds == 600
    assert settings.max_lifetime_seconds == 43200


def test_a_local_worker_takes_any_size_and_never_exits_on_its_own() -> None:
    settings = load_settings({"CLEARFEA_WORKER_TOKEN": "x", "CLEARFEA_MACHINE_SIZE": ""})
    assert settings.machine_size is None
    assert settings.idle_exit_seconds is None
    assert settings.max_lifetime_seconds is None


def test_rejects_a_malformed_machine_size_or_idle_time() -> None:
    with pytest.raises(ConfigError, match="CLEARFEA_MACHINE_SIZE"):
        load_settings({"CLEARFEA_WORKER_TOKEN": "x", "CLEARFEA_MACHINE_SIZE": "Large Machine"})
    with pytest.raises(ConfigError, match="CLEARFEA_IDLE_EXIT_SECONDS"):
        load_settings({"CLEARFEA_WORKER_TOKEN": "x", "CLEARFEA_IDLE_EXIT_SECONDS": "-1"})
