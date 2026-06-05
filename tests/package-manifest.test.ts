import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "bun:test";

const repoDir = fileURLToPath(new URL("..", import.meta.url));
const skillPath = "skills/workflow-code-review-actions/SKILL.md";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  assert.ok(Array.isArray(value), `${key} must be an array`);
  assert.ok(value.every((item) => typeof item === "string"), `${key} must contain only strings`);
  return value;
}

test("package manifest includes code-review actions skill", async () => {
  const parsed: unknown = JSON.parse(await readFile(join(repoDir, "package.json"), "utf8"));
  assert.ok(isRecord(parsed), "package.json must be an object");
  const files = stringArrayField(parsed, "files");
  assert.ok(files.includes("skills"), "npm files must include skills");

  const pi = parsed.pi;
  assert.ok(isRecord(pi), "package.json must contain a pi manifest object");
  const skills = stringArrayField(pi, "skills");
  assert.deepEqual(skills, ["skills"]);

  await access(join(repoDir, skillPath));
  const skill = await readFile(join(repoDir, skillPath), "utf8");
  assert.match(skill, /^---\nname: workflow-code-review-actions/m);
  assert.match(skill, /selected code-review findings/);
  assert.match(skill, /GitHub PR inline comments/);
  assert.match(skill, /gh/);
  assert.match(skill, /GitHub MCP\/tools/);
});
