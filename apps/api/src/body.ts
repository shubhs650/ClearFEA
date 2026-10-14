// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Validation } from "@clearfea/spec";

/**
 * Reads and checks a JSON body; returns the value or a plain-language 400 message.
 * The body must be sent as application/json: a cross-site HTML form cannot send that
 * type without the browser asking first, which the API never allows.
 */
export async function readBody<T>(
  request: Request,
  validate: (value: unknown) => Validation<T>,
  name: string,
  schemaFile: string,
): Promise<{ value: T } | { error: string }> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { error: `Send the ${name} as JSON with the header Content-Type: application/json.` };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: `The request body must be JSON (a ${name}).` };
  }
  const checked = validate(body);
  if (checked.ok) return { value: checked.value };
  return {
    error: `The request body is not a valid ${name} (packages/spec/schemas/${schemaFile}): ${checked.errors.join(" ")}`,
  };
}
