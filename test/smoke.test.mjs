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

// A release publishes package.json to npm and server.json to the MCP Registry,
// and the running server reports the version hard-coded in index.mjs. All three
// must agree, or the provenance-attested tarball and the registry entry describe
// different releases.
test("package.json, server.json and index.mjs carry the same version", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const srv = JSON.parse(readFileSync("server.json", "utf8"));
  const src = readFileSync("index.mjs", "utf8");
  const inCode = (src.match(/name:\s*"katto",\s*version:\s*"([^"]+)"/) || [])[1];
  assert.equal(srv.version, pkg.version, "server.json version");
  assert.equal(srv.packages?.[0]?.version, pkg.version, "server.json packages[0].version");
  assert.equal(inCode, pkg.version, "index.mjs Server version");
  assert.equal(pkg.mcpName, srv.name, "package.json mcpName must equal server.json name");
});
