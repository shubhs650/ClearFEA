// SPDX-License-Identifier: AGPL-3.0-or-later
// Generates TypeScript types and validators from schemas/*.schema.json into src/generated/.
// Usage: node scripts/generate.mjs [--check]
// With --check nothing is written; the script fails if the generated files are out of date.

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(root, "schemas");
const outDir = join(root, "src", "generated");
const check = process.argv.includes("--check");

const header = (source) =>
  [
    "// SPDX-License-Identifier: AGPL-3.0-or-later",
    `// Generated from packages/spec/schemas/${source} by packages/spec/scripts/generate.mjs.`,
    "// Do not edit by hand; change the schema and run `make spec`.",
    "",
  ].join("\n");

async function generate() {
  const files = {};
  const modules = [];
  const sources = (await readdir(schemasDir)).filter((f) => f.endsWith(".schema.json")).sort();
  for (const source of sources) {
    const name = source.replace(/\.schema\.json$/, "");
    const schema = JSON.parse(await readFile(join(schemasDir, source), "utf8"));
    if (typeof schema.title !== "string") throw new Error(`${source} needs a title.`);
    const types = await compile(structuredClone(schema), schema.title, {
      bannerComment: "",
      unreachableDefinitions: true,
      additionalProperties: false,
      cwd: schemasDir,
    });
    const validators = [];
    if (schema.type !== undefined || schema.oneOf !== undefined || schema.anyOf !== undefined) {
      validators.push(`export const validate${schema.title} = validator<${schema.title}>(schema);`);
    }
    for (const [definition, body] of Object.entries(schema.$defs ?? {})) {
      if (Array.isArray(body.enum)) {
        const values = body.enum.map((v) => JSON.stringify(v)).join(", ");
        validators.push(
          `export const ${definition}Values = [${values}] as const satisfies readonly ${definition}[];`,
        );
      }
      validators.push(
        `export const validate${definition} = validator<${definition}>(schema, "${definition}");`,
      );
    }
    files[`${name}.ts`] = [
      header(source),
      `import schema from "../../schemas/${source}";`,
      'import { validator } from "../validate";',
      "",
      types.trimEnd(),
      "",
      ...validators,
      "",
    ].join("\n");
    modules.push(name);
  }
  files["index.ts"] =
    header("*.schema.json") + "\n" + modules.map((m) => `export * from "./${m}";`).join("\n") + "\n";
  return files;
}

const files = await generate();
const existing = await readdir(outDir).catch(() => []);

if (check) {
  const stale = [];
  for (const [name, content] of Object.entries(files)) {
    const current = await readFile(join(outDir, name), "utf8").catch(() => null);
    if (current !== content) stale.push(name);
  }
  for (const name of existing) if (!(name in files)) stale.push(name);
  if (stale.length > 0) {
    console.error(
      `TypeScript types in packages/spec/src/generated are out of date (${stale.join(", ")}). ` +
        "Run `make spec` and commit the result.",
    );
    process.exit(1);
  }
  console.log("TypeScript types match the schemas.");
} else {
  await mkdir(outDir, { recursive: true });
  for (const name of existing) if (!(name in files)) await rm(join(outDir, name));
  for (const [name, content] of Object.entries(files)) await writeFile(join(outDir, name), content);
  console.log(`Wrote ${Object.keys(files).length} files to packages/spec/src/generated.`);
}
