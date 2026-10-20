# SPDX-License-Identifier: AGPL-3.0-or-later
"""infra/aws/worker-image.sh, the AWS side of the solver image deploy (M10.8, ADR-101).

The deploy workflow runs it only on main with the maintainer's AWS account, so these tests run it
against a stand-in `aws` command that answers as the AWS CLI does and records what was asked.
"""

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "infra" / "aws" / "worker-image.sh"
URI = "123456789012.dkr.ecr.ap-south-1.amazonaws.com/clearfea-worker"
NEW = f"{URI}@sha256:{'b' * 64}"
OLD = f"{URI}@sha256:{'a' * 64}"

pytestmark = pytest.mark.skipif(
    shutil.which("jq") is None or shutil.which("bash") is None, reason="needs bash and jq"
)

# Answers like the AWS CLI with --output json/text: the state is a JSON file, calls are logged.
FAKE_AWS = r"""
import json, os, sys
state_file = os.environ["FAKE_AWS_STATE"]
state = json.load(open(state_file))
args = sys.argv[1:]
state.setdefault("calls", []).append(args)
def opt(name):
    return args[args.index(name) + 1]
def save():
    json.dump(state, open(state_file, "w"))
def fail(code, message):
    save()
    sys.stderr.write(f"An error occurred ({code}) when calling the operation: {message}\n")
    sys.exit(254)
service, op = args[0], args[1]
if (service, op) == ("cloudformation", "describe-stacks"):
    if "stack" not in state:
        fail("ValidationError", "Stack with id clearfea does not exist")
    print(state["stack"])
elif (service, op) == ("ecr", "describe-images"):
    tag = opt("--image-ids").split("=", 1)[1]
    if tag not in state.get("tags", {}):
        fail(state.get("describe_error", "ImageNotFoundException"), "not found")
    print(state["tags"][tag])
elif (service, op) == ("ecr", "batch-get-image"):
    print(json.dumps({"imageManifest": '{"layers": []}',
                      "imageManifestMediaType": "application/vnd.oci.image.manifest.v1+json"}))
elif (service, op) == ("ecr", "put-image"):
    if state.get("latest") == "same":
        fail("ImageAlreadyExistsException", "already exists")
elif (service, op) == ("ecs", "describe-task-definition"):
    family = opt("--task-definition")
    if family not in state.get("families", {}):
        fail("ClientException", "Unable to describe task definition.")
    print(json.dumps(state["families"][family]))
elif (service, op) == ("ecs", "register-task-definition"):
    body = json.load(open(opt("--cli-input-json").removeprefix("file://")))
    state.setdefault("registered", []).append(body)
    print(f"arn:aws:ecs:ap-south-1:123456789012:task-definition/{body['family']}:9")
else:
    fail("Unknown", " ".join(args))
save()
"""


def _definition(family: str, image: str) -> dict[str, Any]:
    """A describe-task-definition answer, with the fields only AWS sets."""
    return {
        "taskDefinitionArn": f"arn:aws:ecs:ap-south-1:123456789012:task-definition/{family}:3",
        "family": family,
        "revision": 3,
        "status": "ACTIVE",
        "requiresAttributes": [{"name": "com.amazonaws.ecs.capability.logging-driver.awslogs"}],
        "compatibilities": ["EC2", "FARGATE"],
        "registeredAt": "2026-10-19T08:00:00+00:00",
        "registeredBy": "arn:aws:sts::123456789012:assumed-role/x",
        "requiresCompatibilities": ["FARGATE"],
        "networkMode": "awsvpc",
        "cpu": "4096",
        "memory": "16384",
        "executionRoleArn": "arn:aws:iam::123456789012:role/clearfea-machine-execution",
        "containerDefinitions": [
            {
                "name": "worker",
                "image": image,
                "environment": [{"name": "CLEARFEA_MACHINE_SIZE", "value": "medium"}],
            }
        ],
    }


class Aws:
    def __init__(self, tmp_path: Path, state: dict[str, Any]) -> None:
        self.state_file = tmp_path / "state.json"
        self.state_file.write_text(json.dumps(state))
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        aws = bin_dir / "aws"
        aws.write_text(f"#!{sys.executable}\n{FAKE_AWS}")
        aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_AWS_STATE": str(self.state_file),
        }

    def run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            env=self.env,
            cwd=REPO,
            capture_output=True,
            text=True,
            check=False,
        )

    @property
    def state(self) -> dict[str, Any]:
        return json.loads(self.state_file.read_text())


def test_register_adds_a_revision_with_only_the_image_changed(tmp_path: Path) -> None:
    current = _definition("clearfea-standard", OLD)
    aws = Aws(tmp_path, {"families": {"clearfea-standard": current}})
    result = aws.run("register", NEW)
    assert result.returncode == 0, result.stderr
    [registered] = aws.state["registered"]
    expected = {
        key: value
        for key, value in current.items()
        if key
        not in {
            "taskDefinitionArn",
            "revision",
            "status",
            "requiresAttributes",
            "compatibilities",
            "registeredAt",
            "registeredBy",
        }
    }
    expected["containerDefinitions"] = [{**current["containerDefinitions"][0], "image": NEW}]
    assert registered == expected
    assert "clearfea-large: not defined in the stack" in result.stdout


def test_register_covers_large_when_the_stack_defines_it(tmp_path: Path) -> None:
    families = {
        "clearfea-standard": _definition("clearfea-standard", OLD),
        "clearfea-large": _definition("clearfea-large", OLD),
    }
    aws = Aws(tmp_path, {"families": families})
    result = aws.run("register", NEW)
    assert result.returncode == 0, result.stderr
    assert [body["family"] for body in aws.state["registered"]] == [
        "clearfea-standard",
        "clearfea-large",
    ]


def test_register_skips_a_definition_already_on_the_image(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"families": {"clearfea-standard": _definition("clearfea-standard", NEW)}})
    result = aws.run("register", NEW)
    assert result.returncode == 0, result.stderr
    assert "registered" not in aws.state
    assert "already runs" in result.stdout


def test_register_fails_without_the_standard_machine(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"families": {}})
    result = aws.run("register", NEW)
    assert result.returncode != 0
    assert "Could not read the machine definition clearfea-standard" in result.stderr


def test_register_needs_an_image_pinned_by_digest(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"families": {"clearfea-standard": _definition("clearfea-standard", OLD)}})
    result = aws.run("register", f"{URI}:latest")
    assert result.returncode != 0
    assert "pinned by digest" in result.stderr
    assert aws.state.get("calls") is None


def test_find_prints_the_digest_or_nothing(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"tags": {"src-1": "sha256:" + "c" * 64}})
    found = aws.run("find", "clearfea-worker", "src-1")
    assert (found.returncode, found.stdout.strip()) == (0, "sha256:" + "c" * 64)
    missing = aws.run("find", "clearfea-worker", "src-2")
    assert (missing.returncode, missing.stdout) == (0, "")


def test_find_fails_on_any_other_error(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"describe_error": "AccessDeniedException"})
    result = aws.run("find", "clearfea-worker", "src-1")
    assert result.returncode != 0
    assert "AccessDeniedException" in result.stderr


def test_latest_retags_the_image(tmp_path: Path) -> None:
    digest = "sha256:" + "d" * 64
    aws = Aws(tmp_path, {})
    result = aws.run("latest", "clearfea-worker", digest)
    assert result.returncode == 0, result.stderr
    put = next(call for call in aws.state["calls"] if call[:2] == ["ecr", "put-image"])
    assert put[put.index("--image-tag") + 1] == "latest"
    assert put[put.index("--image-manifest-media-type") + 1].startswith("application/vnd.oci")


def test_latest_already_there_is_not_an_error(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"latest": "same"})
    result = aws.run("latest", "clearfea-worker", "sha256:" + "d" * 64)
    assert result.returncode == 0, result.stderr
    assert "was already" in result.stdout


def test_stack_names_the_image_store(tmp_path: Path) -> None:
    aws = Aws(tmp_path, {"stack": URI})
    result = aws.run("stack", "clearfea")
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == [f"repository_uri={URI}", "repository=clearfea-worker"]


def test_stack_missing_points_to_the_guide(tmp_path: Path) -> None:
    result = Aws(tmp_path, {}).run("stack", "clearfea")
    assert result.returncode != 0
    assert "section 4.3" in result.stderr


def test_tag_names_the_worker_and_spec_source() -> None:
    result = subprocess.run(
        ["bash", str(SCRIPT), "tag"], cwd=REPO, capture_output=True, text=True, check=True
    )
    tag = result.stdout.strip()
    assert tag.startswith("src-") and len(tag) == 24
    trees = [
        subprocess.run(
            ["git", "rev-parse", f"HEAD:{path}"],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        for path in ("worker", "packages/spec")
    ]
    digest = subprocess.run(
        ["sha256sum"], input=f"{trees[0]} {trees[1]}\n", capture_output=True, text=True, check=True
    ).stdout
    assert tag == "src-" + digest[:20]


def test_the_names_and_permissions_match_the_aws_stack() -> None:
    from tests.test_aws_template import _template

    template = _template()
    resources = template["Resources"]
    families = {
        resource["Properties"]["Family"]
        for resource in resources.values()
        if resource["Type"] == "AWS::ECS::TaskDefinition"
    }
    script = SCRIPT.read_text(encoding="utf-8")
    assert "FAMILIES=(clearfea-standard clearfea-large)" in script
    assert families == {"clearfea-standard", "clearfea-large"}
    assert "WorkerRepositoryUri" in template["Outputs"]
    for resource in resources.values():
        if resource["Type"] == "AWS::ECS::TaskDefinition":
            [container] = resource["Properties"]["ContainerDefinitions"]
            assert container["Name"] == "worker"
    policies = resources["DeployRole"]["Properties"]["Policies"]
    assert {policy["PolicyName"] for policy in policies} == {
        "deploy-worker-image",
        "clearfea-read-machine-logs",  # the name the maintainer gave it by hand (M10.9)
    }
    granted = set()
    for policy in policies:
        for statement in policy["PolicyDocument"]["Statement"]:
            actions = statement["Action"]
            granted.update([actions] if isinstance(actions, str) else actions)
    used = {
        "cloudformation:DescribeStacks",
        "ecr:GetAuthorizationToken",
        "ecr:DescribeImages",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:BatchCheckLayerAvailability",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "iam:PassRole",
        # the Machine logs workflow
        "ecs:ListTasks",
        "ecs:DescribeTasks",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
    }
    assert used <= granted
    workflow = (REPO / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
    assert "STACK_NAME: clearfea" in workflow
    subjects = resources["DeployRole"]["Properties"]["AssumeRolePolicyDocument"]["Statement"][0][
        "Condition"
    ]["StringLike"]["token.actions.githubusercontent.com:sub"]
    # GitHub names some repositories by numeric ids in the token (owner@id/name@id).
    condition, with_ids, without_ids = subjects["If"]
    assert condition == "RepositoryIds"
    assert {"Sub": "repo:${GitHubRepositoryIds}:environment:production"} in with_ids
    for names in (with_ids, without_ids):
        assert {"Sub": "repo:${GitHubRepository}:environment:production"} in names
    assert re.fullmatch(
        template["Parameters"]["GitHubRepositoryIds"]["AllowedPattern"].split("|")[1],
        template["Parameters"]["GitHubRepositoryIds"]["Default"],
    )
