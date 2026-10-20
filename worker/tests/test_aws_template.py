# SPDX-License-Identifier: AGPL-3.0-or-later
"""The AWS stack's machine definitions start this worker as ADR-099 and ADR-100 describe.

infra/aws/clearfea.yaml is uploaded by hand (docs/DEPLOYMENT.md section 4.3), so nothing else
checks that its environment variables are ones the worker reads, with values it accepts.
"""

import json
import re
from pathlib import Path
from typing import Any

import yaml

from clearfea_worker.config import load_settings

TEMPLATE = Path(__file__).resolve().parents[2] / "infra" / "aws" / "clearfea.yaml"


class _CloudFormationLoader(yaml.SafeLoader):
    """Reads CloudFormation's short-form tags (!Ref, !Sub, ...) as {"Fn": value}."""


def _tag(loader: yaml.SafeLoader, suffix: str, node: yaml.Node) -> dict[str, Any]:
    if isinstance(node, yaml.ScalarNode):
        value: Any = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node, deep=True)
    else:
        value = loader.construct_mapping(node, deep=True)  # type: ignore[arg-type]
    return {suffix: value}


_CloudFormationLoader.add_multi_constructor("!", _tag)


def _template() -> dict[str, Any]:
    with TEMPLATE.open(encoding="utf-8") as file:
        return yaml.load(file, Loader=_CloudFormationLoader)  # noqa: S506 - SafeLoader subclass


def _environment(definition: dict[str, Any]) -> dict[str, Any]:
    [container] = definition["Properties"]["ContainerDefinitions"]
    assert container["Name"] == "worker"  # the name the API's RunTask overrides name
    return {item["Name"]: item["Value"] for item in container["Environment"]}


def test_each_machine_definition_starts_a_worker_of_its_size() -> None:
    resources = _template()["Resources"]
    sizes = {"StandardTaskDefinition": ("clearfea-standard", "medium", "4096", "16384")}
    sizes["LargeTaskDefinition"] = ("clearfea-large", "large", "8192", "32768")
    for name, (family, size, cpu, memory) in sizes.items():
        definition = resources[name]
        properties = definition["Properties"]
        shape = (properties["Family"], properties["Cpu"], properties["Memory"])
        assert shape == (family, cpu, memory)
        environment = _environment(definition)
        assert environment["CLEARFEA_MACHINE_SIZE"] == size
        # The API adds the worker id and token when it starts the machine (ADR-100).
        values = {
            key: "https://clearfea.example" if isinstance(value, dict) else value
            for key, value in environment.items()
        }
        settings = load_settings(
            {**values, "CLEARFEA_WORKER_TOKEN": "token", "CLEARFEA_WORKER_ID": "aws-1"}
        )
        assert settings.machine_size == size
        assert settings.idle_exit_seconds == 600
        assert settings.max_lifetime_seconds == 43200
        assert set(environment) <= {
            "CLEARFEA_API_URL",
            "CLEARFEA_MACHINE_SIZE",
            "CLEARFEA_IDLE_EXIT_SECONDS",
            "CLEARFEA_MAX_LIFETIME_SECONDS",
        }


def test_the_launch_parameter_names_both_families_for_the_api() -> None:
    parameter = _template()["Resources"]["LaunchParameter"]["Properties"]
    # LAUNCH_PARAMETER in apps/api/src/launcher/aws.ts
    assert parameter["Name"] == "/clearfea/launch"
    text, substitutions = parameter["Value"]["Sub"]
    large = substitutions["LargeEntry"]["If"][1]
    for entry in (large, ""):
        value = json.loads(re.sub(r"\$\{(\w+)\}", "x", text.replace("${LargeEntry}", entry)))
        assert set(value) == {"cluster", "subnets", "securityGroup", "taskDefinitions"}
        expected = {"medium": "clearfea-standard"}
        if entry:
            expected["large"] = "clearfea-large"
        assert value["taskDefinitions"] == expected


def test_the_worker_image_trusts_public_certificates() -> None:
    """The machines reach the site over https, which needs the system's CA certificates in the
    image's last stage, not only in the build stages (M10.9)."""
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    final_stage = dockerfile.rsplit("\nFROM ", 1)[1]
    assert re.search(r"apt-get install[^&]*\bca-certificates\b", final_stage)
