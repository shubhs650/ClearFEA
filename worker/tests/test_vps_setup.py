# SPDX-License-Identifier: AGPL-3.0-or-later
"""The solver VPS's files (M12.5, ADR-110, ADR-131) start the manager as ADR-107 describes.

infra/vps is installed by hand on the VPS (docs/DEPLOYMENT.md section 4.3), so nothing else
checks that its environment template holds settings the manager reads, with values it accepts,
or that the systemd unit runs the image the updater points at.
"""

import re
from pathlib import Path

import pytest

from clearfea_worker.config import ConfigError
from clearfea_worker.manager.config import DEFAULT_LIGHT, DEFAULT_SOLVE, load_manager_settings

VPS = Path(__file__).resolve().parents[2] / "infra" / "vps"
#: Read by update-image.sh only, not by the manager.
UPDATER_ONLY = {"CLEARFEA_IMAGE_PIN"}


def _template() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (VPS / "manager.env.example").read_text().splitlines():
        if line.strip() == "" or line.startswith("#"):
            continue
        # Docker's --env-file takes NAME=value literally: no quotes, no spaces around "=".
        assert re.fullmatch(r"[A-Z0-9_]+=[^\"' ]*", line), line
        name, value = line.split("=", 1)
        values[name] = value
    return values


def test_template_names_only_settings_the_manager_or_updater_reads() -> None:
    # The lanes' settings are named from the lane: CLEARFEA_SOLVE_CPUSET and so on.
    lanes = {
        f"CLEARFEA_{lane.name.upper()}_{part}"
        for lane in (DEFAULT_SOLVE, DEFAULT_LIGHT)
        for part in ("CPUS", "CPUSET", "MEMORY")
    }
    known = set(re.findall(r"CLEARFEA_[A-Z0-9_]+", _manager_sources())) | lanes | UPDATER_ONLY
    assert set(_template()) <= known


def _manager_sources() -> str:
    package = Path(__file__).resolve().parents[1] / "clearfea_worker"
    return "".join(
        p.read_text() for p in [package / "config.py", *(package / "manager").glob("*.py")]
    )


def test_template_with_its_secrets_filled_in_gives_the_vps_lanes() -> None:
    env = _template() | {
        "CLEARFEA_WORKER_TOKEN": "t" * 40,
        "CLEARFEA_ACCESS_CLIENT_ID": "id.access",
        "CLEARFEA_ACCESS_CLIENT_SECRET": "secret",
    }
    settings = load_manager_settings(env)
    assert settings.worker.api_url == "https://clearfea.triyalabs.com"
    assert settings.image == "clearfea-worker:current"
    assert settings.network == "bridge"
    lanes = {lane.name: lane for lane in settings.lanes}
    assert (lanes["solve"].cpuset, lanes["solve"].memory_bytes) == ("0-5", 17 * 1024**3)
    assert (lanes["light"].cpuset, lanes["light"].memory_bytes) == ("6", 4 * 1024**3)
    assert settings.scratch_path == "/var/lib/docker"
    assert settings.scratch_min_free_bytes == 20 * 1024**3


def test_template_leaves_the_secrets_to_bootstrap() -> None:
    template = _template()
    for name in (
        "CLEARFEA_WORKER_TOKEN",
        "CLEARFEA_ACCESS_CLIENT_ID",
        "CLEARFEA_ACCESS_CLIENT_SECRET",
    ):
        assert template[name] == "", name
    with pytest.raises(ConfigError):
        load_manager_settings(template)


def test_unit_runs_the_manager_from_the_image_the_updater_points_at() -> None:
    unit = (VPS / "clearfea-manager.service").read_text()
    assert "--env-file /etc/clearfea/manager.env" in unit
    assert re.search(r"clearfea-worker:current manager$", unit, re.MULTILINE)
    assert "Restart=always" in unit
    # The scratch path of the template is mounted where the manager looks for it.
    assert f"{_template()['CLEARFEA_SCRATCH_PATH']}:/var/lib/docker:ro" in unit
    updater = (VPS / "update-image.sh").read_text()
    assert "CURRENT=$REPOSITORY:current" in updater and "REPOSITORY=clearfea-worker" in updater
