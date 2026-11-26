#!/usr/bin/env bun
// SPDX-License-Identifier: MPL-2.0
// Checks for the Dependabot configuration (.github/dependabot.yml).
//
// Run from the repository root with:
//     bun install --frozen-lockfile && bun tests/dependabot.js
// Exit 0 when every check passes, 1 when any fails.
// Uses the `yaml` devDependency (pinned in package.json / bun.lock), read with
// the YAML 1.1 schema PyYAML used, so integers stay distinct from floats and
// duplicate keys can be seen in the parse tree.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Alias, isMap, isScalar, isSeq, parseDocument } from "yaml";

const CONFIG = join(dirname(import.meta.path), "..", ".github", "dependabot.yml");

// Values from GitHub's Dependabot configuration options reference.
const SUPPORTED_ECOSYSTEMS = new Set([
  "apm", "bazel", "bun", "bundler", "cargo", "composer", "conda",
  "deno", "devcontainers", "docker", "docker-compose", "dotnet-sdk",
  "elm", "github-actions", "gitsubmodule", "gomod", "gradle", "helm",
  "julia", "maven", "mix", "nix", "npm", "nuget", "opentofu", "pip",
  "pre-commit", "pub", "rust-toolchain", "sbt", "swift", "terraform",
  "uv", "vcpkg",
]);

const show = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? Number(x) : x));
const isDict = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const isStr = (v) => typeof v === "string";
function assert(ok, message) {
  if (!ok) throw new Error(message);
}

let source;
let doc;
let config;
try {
  source = readFileSync(CONFIG, "utf8");
  doc = parseDocument(source, { version: "1.1", intAsBigInt: true, uniqueKeys: false });
  if (doc.errors.length) throw doc.errors[0];
  config = doc.toJS({ maxAliasCount: -1 });
} catch (e) {
  console.error(`ERROR: cannot load ${CONFIG}: ${e.message}`);
  process.exit(1);
}

function updates() {
  assert(isDict(config), `${show(config)} is not a mapping`);
  const list = config.updates;
  assert(Array.isArray(list), `${show(list)} is not a list`);
  assert(list.length > 0, "At least one update must be configured");
  for (const update of list) assert(isDict(update), `${show(update)} is not a mapping`);
  return list;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("configuration version", () => {
  assert(isDict(config), `${show(config)} is not a mapping`);
  const version = config.version;
  assert(typeof version === "bigint", `version ${show(version)} is not an integer`);
  assert(version === 2n, `version ${show(version)} != 2`);
});

test("each update names a supported ecosystem", () => {
  const bad = [];
  for (const update of updates()) {
    const ecosystem = update["package-ecosystem"];
    if (!isStr(ecosystem) || !SUPPORTED_ECOSYSTEMS.has(ecosystem)) bad.push(ecosystem);
  }
  assert(bad.length === 0, `unsupported package-ecosystem: ${show(bad)}`);
});

test("root update is scheduled weekly", () => {
  assert(
    updates().some(
      (u) => u.directory === "/" && isDict(u.schedule) && u.schedule.interval === "weekly",
    ),
    "Expected a weekly update for the repository root",
  );
});

test("yaml has no duplicate mapping keys", () => {
  // Keys are compared by their source text, as PyYAML's composed nodes do.
  const seen = new Set();
  const checkNode = (node) => {
    if (node instanceof Alias) node = node.resolve(doc);
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (isMap(node)) {
      const keys = new Set();
      for (const pair of node.items) {
        assert(isScalar(pair.key), `non-scalar mapping key: ${show(String(pair.key))}`);
        const k = pair.key;
        const key = k.type === "PLAIN" && k.range ? source.slice(k.range[0], k.range[1]) : String(k.value ?? "");
        assert(!keys.has(key), `Duplicate YAML key: ${key}`);
        keys.add(key);
        checkNode(pair.value);
      }
    } else if (isSeq(node)) {
      node.items.forEach(checkNode);
    }
  };
  checkNode(doc.contents);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}
console.log(`\nRan ${tests.length} checks: ${failures === 0 ? "OK" : `FAILED (failures=${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
