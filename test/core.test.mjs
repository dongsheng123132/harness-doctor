import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VERSION,
  createSupportBundle,
  listFixes,
  nodeSupportsDsh,
  parseCli,
  parseTargetNames,
  preferRunnablePaths,
  runDoctor,
  runFix,
  summarize
} from "../lib/core.mjs";

test("CLI version stays aligned with package metadata", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, packageJson.version);
});

test("parses an explicit target set", () => {
  assert.deepEqual(parseTargetNames("dsh,codex,dsh"), ["dsh", "codex"]);
  assert.deepEqual(parseCli(["--target", "claude", "--no-ports"]).targets, ["claude"]);
});

test("rejects unknown targets and unsafe timeouts", () => {
  assert.throws(() => parseTargetNames("weather"), /unknown target/);
  assert.throws(() => parseCli(["--timeout", "10"]), /100 to 30000/);
});

test("applies the exact DSH Node compatibility floor", () => {
  assert.equal(nodeSupportsDsh("v22.18.9"), false);
  assert.equal(nodeSupportsDsh("22.19.0"), true);
  assert.equal(nodeSupportsDsh("23.9.0"), false);
  assert.equal(nodeSupportsDsh("24.0.0"), true);
});

test("prefers executable Windows shims over extensionless POSIX shims", () => {
  assert.deepEqual(
    preferRunnablePaths(["C:\\npm\\codex", "C:\\npm\\codex.cmd", "C:\\app\\codex.exe"], "win32"),
    ["C:\\npm\\codex.cmd", "C:\\app\\codex.exe"]
  );
});

test("strict mode turns warnings into a failing result", () => {
  const checks = [{ status: "pass" }, { status: "warn" }];
  assert.equal(summarize(checks, false).ok, true);
  assert.equal(summarize(checks, true).ok, false);
});

test("report never includes credential values", async () => {
  const secret = "sk-do-not-print-me";
  const report = await runDoctor(
    {
      targets: ["dsh"],
      ports: true,
      platform: "win32",
      arch: "x64",
      nodeVersion: "24.1.0",
      home: "C:\\Users\\test",
      cwd: "C:\\work",
      env: { DEEPSEEK_API_KEY: secret, ComSpec: "cmd.exe" }
    },
    {
      findExecutables(command) {
        return command === "node" ? ["C:\\node.exe"] : ["C:\\dsh.cmd"];
      },
      runVersion(executable) {
        return { ok: true, version: executable.includes("node") ? "v24.1.0" : "0.1.0-rc.6", error: null };
      },
      pathExists() {
        return true;
      },
      countEntries() {
        return 2;
      },
      async portOpen() {
        return false;
      }
    }
  );
  assert.equal(report.ok, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.deepEqual(
    report.checks.find((item) => item.id === "tool.dsh.credentials").details.present_names,
    ["DEEPSEEK_API_KEY"]
  );
});

test("missing harness command is a stable failure with a fix id", async () => {
  const report = await runDoctor(
    {
      targets: ["codex"],
      ports: false,
      platform: "linux",
      home: "/home/test",
      cwd: "/work",
      env: { SHELL: "/bin/sh" }
    },
    {
      findExecutables(command) {
        return command === "node" ? ["/usr/bin/node"] : [];
      },
      runVersion() {
        return { ok: true, version: "v24.1.0", error: null };
      }
    }
  );
  assert.equal(report.ok, false);
  assert.equal(report.exit_code, 1);
  assert.equal(report.checks.find((item) => item.id === "tool.codex.command").fix_id, "install_codex");
});

test("support bundle redacts home, workspace, and token-shaped values", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "harness-doctor-test-"));
  try {
    const output = path.join(dir, "support.json");
    const report = {
      schema_version: "harness-doctor/v1",
      generated_at: "2026-08-14T00:00:00.000Z",
      workspace: "C:\\Users\\alice\\secret-work",
      summary: { pass: 1, warn: 0, fail: 0 },
      checks: [{ details: { path: "C:\\Users\\alice\\.codex", note: "sk-abcdefghijk12345", entry_counts: { "C:\\Users\\alice\\.codex": 2 } } }]
    };
    const result = createSupportBundle(report, {
      output,
      home: "C:\\Users\\alice",
      workspace: "C:\\Users\\alice\\secret-work"
    });
    const body = readFileSync(output, "utf8");
    assert.equal(result.ok, true);
    assert.equal(body.includes("alice"), false);
    assert.equal(body.includes("secret-work"), false);
    assert.equal(body.includes("sk-abcdefghijk12345"), false);
    assert.match(body, /<WORKSPACE>/);
    assert.match(body, /<HOME>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fix execution requires one explicit id and confirmation", () => {
  assert.ok(listFixes().some((item) => item.id === "install_dsh"));
  const pending = runFix("install_dsh", { yes: false });
  assert.equal(pending.exit_code, 2);
  assert.equal(pending.reason, "confirmation_required");

  let called = 0;
  const done = runFix(
    "install_dsh",
    { yes: true },
    {
      runCommand(command, args) {
        called += 1;
        assert.equal(command, "npm");
        assert.deepEqual(args, ["install", "-g", "@deepseek-ai/dsh@0.1.0-rc.6"]);
        return { ok: true, exitCode: 0, stdout: "installed", stderr: "", error: null };
      }
    }
  );
  assert.equal(called, 1);
  assert.equal(done.ok, true);
});
