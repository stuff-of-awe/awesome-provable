// SPDX-License-Identifier: MPL-2.0
// Run from the repository root: bun test tests/dependabot.test.js

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = "configuration version";
const ECOSYSTEM = "each update names a supported ecosystem";
const SCHEDULE = "root update is scheduled weekly";
const KEYS = "yaml has no duplicate mapping keys";

const weeklyRoot = `  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
`;
const config = (version = "2", updates = weeklyRoot) => `version: ${version}\nupdates:\n${updates}`;

function runValidator(source) {
    const root = mkdtempSync(join(tmpdir(), "dependabot-test-"));
    try {
        const script = join(root, "tests", "dependabot.js");
        mkdirSync(join(root, "tests"));
        mkdirSync(join(root, ".github"));
        // The CLI resolves its config relative to its own location.
        copyFileSync(join(import.meta.dir, "dependabot.js"), script);
        symlinkSync(join(import.meta.dir, "..", "node_modules"), join(root, "node_modules"), "dir");
        if (source !== undefined) {
            writeFileSync(join(root, ".github", "dependabot.yml"), source);
        }

        const result = spawnSync(process.execPath, [script], {
            cwd: root,
            encoding: "utf8",
            timeout: 3000,
        });
        if (result.error) throw result.error;
        return result;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function expectChecks(source, failures = []) {
    const { status, stdout, stderr } = runValidator(source);
    expect(stderr).toBe("");
    expect(stdout.match(/^(?:ok    |FAIL  ).+$/gm)).toEqual(
        [VERSION, ECOSYSTEM, SCHEDULE, KEYS].map((name) =>
            `${failures.includes(name) ? "FAIL  " : "ok    "}${name}`,
        ),
    );
    expect(stdout.trimEnd()).toEndWith(
        failures.length ? `Ran 4 checks: FAILED (failures=${failures.length})` : "Ran 4 checks: OK",
    );
    expect(status).toBe(failures.length ? 1 : 0);
    return stdout;
}

test("accepts a valid config with additional supported updates in separate mappings", () => {
    expectChecks(config("2", `  - package-ecosystem: github-actions
    directory: "/tools"
    schedule:
      interval: daily
${weeklyRoot}`));
});

test("accepts the YAML 1.1 hexadecimal spelling of version 2", () => {
    expectChecks(config("0x2"));
});

test.each([
    ["float", "2.0"],
    ["quoted integer", '"2"'],
    ["boolean", "true"],
    ["different integer", "3"],
    ["integer beyond the safe Number range", "9007199254740993"],
])("rejects a %s as version 2", (_label, version) => {
    expectChecks(config(version), [VERSION]);
});

test.each([
    ["unsupported ecosystem", "unknown-ecosystem"],
    ["sequence instead of ecosystem string", "[npm]"],
    ["missing ecosystem value", "null"],
])("rejects an additional update with %s", (_label, ecosystem) => {
    expectChecks(config("2", weeklyRoot + `  - package-ecosystem: ${ecosystem}\n`), [ECOSYSTEM]);
});

test("requires the root directory and weekly interval on the same update", () => {
    const dailyRoot = weeklyRoot.replace("interval: weekly", "interval: daily");
    const weeklySubdirectory = weeklyRoot.replace('directory: "/"', 'directory: "/tools"');
    expectChecks(config("2", dailyRoot + weeklySubdirectory), [SCHEDULE]);
});

test("rejects a scalar schedule on the root update", () => {
    expectChecks(config("2", `  - package-ecosystem: npm
    directory: "/"
    schedule: weekly
`), [SCHEDULE]);
});

test.each([
    ["missing", "version: 2\n"],
    ["a mapping", "version: 2\nupdates: {}\n"],
    ["empty", "version: 2\nupdates: []\n"],
    ["a sequence containing a scalar after a valid update", config("2", weeklyRoot + "  - npm\n")],
])("rejects updates that are %s", (_label, source) => {
    expectChecks(source, [ECOSYSTEM, SCHEDULE]);
});

test("rejects a YAML sequence at the document root", () => {
    expectChecks("- version: 2\n", [VERSION, ECOSYSTEM, SCHEDULE]);
});

test("rejects a repeated key at the document root even when both values are valid", () => {
    const stdout = expectChecks(config() + "version: 2\n", [KEYS]);
    expect(stdout).toContain("Duplicate YAML key: version");
});

test("rejects equivalent quoted and plain keys in a nested mapping", () => {
    const stdout = expectChecks(config() + "      'interval': weekly\n", [KEYS]);
    expect(stdout).toContain("Duplicate YAML key: interval");
});

test("keeps distinct plain key spellings even when YAML parses them as equal integers", () => {
    expectChecks(config() + "metadata:\n  2: decimal\n  0x2: hexadecimal\n");
});

test("accepts a weekly schedule shared by YAML alias", () => {
    expectChecks(`schedule-defaults: &weekly
  interval: weekly
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: *weekly
`);
});

test("rejects a non-scalar mapping key", () => {
    const stdout = expectChecks(config() + "metadata:\n  ? [one, two]\n  : value\n", [KEYS]);
    expect(stdout).toContain("non-scalar mapping key");
});

test.each([
    ["invalid YAML", "version: [\n"],
    ["an unresolved alias", config() + "metadata: *missing\n"],
    ["a missing file", undefined],
])("reports a load error for %s", (_label, source) => {
    const { status, stderr, stdout } = runValidator(source);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^ERROR: cannot load .*dependabot\.yml:/);
    expect(stdout).toBe("");
});
