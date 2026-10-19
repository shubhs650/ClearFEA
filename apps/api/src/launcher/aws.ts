// SPDX-License-Identifier: AGPL-3.0-or-later
// The two AWS calls the launcher makes (M10.7, ADR-095 item 6): reading the launch settings the
// CloudFormation stack wrote to Systems Manager, and ECS RunTask. Both are AWS JSON 1.1 APIs,
// signed with the launcher's key (sigv4.ts). The fetch function is passed in so the tests can
// stand in for AWS.

import type { Env } from "../env";
import { type AwsCredentials, signRequest } from "./sigv4";

export type Fetch = (request: Request) => Promise<Response>;

export interface AwsAccess {
  region: string;
  credentials: AwsCredentials;
  fetch: Fetch;
}

/** The name of the Systems Manager parameter the stack writes (infra/aws/clearfea.yaml). */
export const LAUNCH_PARAMETER = "/clearfea/launch";

/** What the stack tells the API about how to start a machine: the parameter's JSON value. */
export interface LaunchSettings {
  cluster: string;
  subnets: string[];
  securityGroup: string;
  /** The ECS task definition family per machine size name (medium, large). */
  taskDefinitions: Record<string, string>;
}

/** The AWS access the API has, or why it has none: what the admin must set (DEPLOYMENT.md 4.4). */
export function awsAccess(env: Env, fetcher: Fetch): AwsAccess | { problem: string } {
  const region = env.AWS_REGION?.trim();
  const accessKeyId = env.AWS_LAUNCHER_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_LAUNCHER_SECRET_ACCESS_KEY?.trim();
  const missing = [
    region ? null : "AWS_REGION",
    accessKeyId ? null : "AWS_LAUNCHER_ACCESS_KEY_ID",
    secretAccessKey ? null : "AWS_LAUNCHER_SECRET_ACCESS_KEY",
  ].filter((name) => name !== null);
  if (!region || !accessKeyId || !secretAccessKey) {
    return { problem: `The API cannot start solver machines: ${missing.join(", ")} not set (docs/DEPLOYMENT.md section 4).` };
  }
  return { region, credentials: { accessKeyId, secretAccessKey }, fetch: fetcher };
}

export class AwsError extends Error {}

/** Calls one AWS JSON 1.1 action and returns its parsed answer; an AWS error becomes an AwsError with AWS's message. */
async function call(access: AwsAccess, service: string, target: string, payload: unknown): Promise<unknown> {
  const url = `https://${service}.${access.region}.amazonaws.com/`;
  const body = JSON.stringify(payload);
  const headers = await signRequest({
    method: "POST",
    url,
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": target },
    body,
    region: access.region,
    service,
    credentials: access.credentials,
    now: new Date(),
  });
  // Host is set by fetch from the URL; sending it as well is refused by some runtimes.
  const { host: _host, ...send } = headers;
  let response: Response;
  try {
    response = await access.fetch(new Request(url, { method: "POST", headers: send, body }));
  } catch (error) {
    throw new AwsError(`AWS could not be reached (${error instanceof Error ? error.message : String(error)}).`);
  }
  // AWS answers as application/x-amz-json-1.1, which workerd would warn about reading as text.
  const text = new TextDecoder().decode(await response.arrayBuffer());
  let parsed: unknown = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    // An answer that is not JSON keeps parsed null; the status says what went wrong.
  }
  if (!response.ok) {
    const fields = (parsed ?? {}) as { __type?: string; message?: string; Message?: string };
    const type = fields.__type?.split("#").pop() ?? `HTTP ${response.status}`;
    throw new AwsError(`AWS refused ${target.split(".").pop()}: ${type}: ${fields.message ?? fields.Message ?? text.slice(0, 200)}`);
  }
  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== "");
}

/** The launch settings from Systems Manager. */
export async function readLaunchSettings(access: AwsAccess): Promise<LaunchSettings> {
  const answer = (await call(access, "ssm", "AmazonSSM.GetParameter", { Name: LAUNCH_PARAMETER })) as {
    Parameter?: { Value?: string };
  } | null;
  let value: unknown;
  try {
    value = JSON.parse(answer?.Parameter?.Value ?? "");
  } catch {
    value = null;
  }
  const settings = value as Partial<LaunchSettings> | null;
  const families = settings?.taskDefinitions;
  if (
    typeof settings?.cluster !== "string" ||
    !isStringArray(settings.subnets) ||
    typeof settings.securityGroup !== "string" ||
    typeof families !== "object" ||
    families === null ||
    !Object.values(families).every((f) => typeof f === "string")
  ) {
    throw new AwsError(
      `The parameter ${LAUNCH_PARAMETER} is not what the stack writes. Update the clearfea stack from infra/aws/clearfea.yaml.`,
    );
  }
  return settings as LaunchSettings;
}

export interface MachineToStart {
  /** The task definition family. */
  family: string;
  /** Environment variables for this machine only, on top of its task definition's. */
  environment: Record<string, string>;
}

/** Starts one Fargate task and returns its ARN. */
export async function runTask(access: AwsAccess, launch: LaunchSettings, machine: MachineToStart): Promise<string> {
  const answer = (await call(access, "ecs", "AmazonEC2ContainerServiceV20141113.RunTask", {
    cluster: launch.cluster,
    taskDefinition: machine.family,
    launchType: "FARGATE",
    count: 1,
    startedBy: "clearfea-api",
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: launch.subnets,
        securityGroups: [launch.securityGroup],
        // Public subnets with no NAT gateway: the machine reaches the API and the image store
        // through its own public address (ADR-095 item 8). Nothing can connect to it.
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "worker",
          environment: Object.entries(machine.environment).map(([name, value]) => ({ name, value })),
        },
      ],
    },
  })) as { tasks?: { taskArn?: string }[]; failures?: { reason?: string; detail?: string }[] } | null;
  const arn = answer?.tasks?.[0]?.taskArn;
  if (typeof arn === "string") return arn;
  const failure = answer?.failures?.[0];
  throw new AwsError(
    `AWS did not start the machine: ${failure?.reason ?? "no task and no reason given"}${failure?.detail ? ` (${failure.detail})` : ""}.`,
  );
}
