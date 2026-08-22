import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("package.json is valid and correctly declared", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, "katto-mcp");
  assert.equal(pkg.license, "MIT");
  assert.ok(pkg.bin || pkg.main || pkg.files?.includes("index.mjs"));
});

test("server entry exposes the documented tools", () => {
  const src = readFileSync("index.mjs", "utf8");
  for (const tool of [
    "katto_create_clip_job",
    "katto_get_job",
    "katto_get_clips",
    "katto_get_transcript",
    "katto_get_usage",
  ]) {
    assert.ok(src.includes(tool), `missing tool: ${tool}`);
  }
});
