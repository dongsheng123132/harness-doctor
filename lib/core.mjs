import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const SCHEMA_VERSION = "harness-doctor/v1";
const SUPPORT_SCHEMA_VERSION = "harness-support/v1";
const DEFAULT_TIMEOUT_MS = 5_000;

const TARGETS = Object.freeze({
  dsh: {
    name: "DeepSeek Harness",
    command: "dsh",
    versionArgs: ["--version"],
    credentials: ["DEEPSEEK_API_KEY"],
    configs: [".dsh/profiles"],
    ports: [3080],
    nodeRequirement: "22.19+ or 24+"
  },
  claude: {
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    credentials: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    configs: [".claude.json", ".claude"],
    ports: []
  },
  codex: {
    name: "Codex CLI",
    command: "codex",
    versionArgs: ["--version"],
    credentials: ["OPENAI_API_KEY"],
    configs: [".codex/auth.json", ".codex/config.toml"],
    ports: []
  },
  openclaw: {
    name: "OpenClaw",
    command: "openclaw",
    versionArgs: ["--version"],
    credentials: [],
    configs: [".openclaw/openclaw.json"],
    ports: [18789]
  }
});

const FIXES = Object.freeze({
  install_dsh: {
    target: "dsh",
    risk: "medium",
    summary: "Install the verified DeepSeek Harness preview globally",
    command: "npm",
    args: ["install", "-g", "@deepseek-ai/dsh@0.1.0-rc.6"]
  },
  repair_dsh: {
    target: "dsh",
    risk: "medium",
    summary: "Force reinstall the verified DeepSeek Harness preview globally",
    command: "npm",
    args: ["install", "-g", "@deepseek-ai/dsh@0.1.0-rc.6", "--force"]
  }
});

const HELP = `harness-doctor — read-only checks for AI agent harnesses

Usage:
  harness-doctor [options]
  harness-doctor bundle [options]
  harness-doctor fixes [--json]
  harness-doctor fix <fix_id> [--yes] [--json]

Options:
  -t, --target <names>   comma-separated targets: all,dsh,claude,codex,openclaw
  -C, --cwd <path>       workspace to report (default: current directory)
      --json             emit one stable JSON object to stdout
      --strict           treat warnings as a failing result
      --no-ports         skip localhost port probes
      --timeout <ms>     command/port timeout, 100..30000 (default: 5000)
  -o, --output <path>    support bundle output path (bundle only)
      --yes              execute one explicitly selected fix
  -h, --help             show help
  -V, --version          show version

Doctor and bundle are read-only. Fix requires one allowlisted fix_id plus --yes.
`;

class UsageError extends Error {}

function nodeSupportsDsh(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .replace(/^v/, "")
    .split(".")
    .slice(0, 3)
    .map((value) => Number.parseInt(value, 10) || 0);
  if (major >= 24) return true;
  if (major !== 22) return false;
  if (minor > 19) return true;
  return minor === 19 && patch >= 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function preferRunnablePaths(values, platform = process.platform) {
  const paths = unique(values);
  if (platform !== "win32") return paths;
  const runnable = paths.filter((value) => /\.(exe|com|cmd|bat)$/i.test(value));
  return runnable.length ? runnable : paths;
}

function parseTargetNames(raw = "all") {
  const names = unique(
    String(raw)
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!names.length || names.includes("all")) return Object.keys(TARGETS);
  const unknown = names.filter((name) => !TARGETS[name]);
  if (unknown.length) throw new UsageError(`unknown target: ${unknown.join(", ")}`);
  return names;
}

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        target: { type: "string", short: "t", default: "all" },
        cwd: { type: "string", short: "C" },
        json: { type: "boolean" },
        strict: { type: "boolean" },
        "no-ports": { type: "boolean" },
        timeout: { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
        output: { type: "string", short: "o" },
        yes: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "V" }
      }
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const timeoutMs = Number(parsed.values.timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new UsageError("--timeout must be an integer from 100 to 30000 milliseconds");
  }
  return {
    ...parsed.values,
    command: parsed.positionals[0] || "doctor",
    positionals: parsed.positionals.slice(1),
    targets: parseTargetNames(parsed.values.target),
    ports: !parsed.values["no-ports"],
    timeoutMs
  };
}

function redactText(value, replacements = []) {
  let text = String(value);
  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    text = text.replaceAll(String(needle), replacement);
    text = text.replaceAll(String(needle).replaceAll("\\", "/"), replacement);
  }
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "<REDACTED_TOKEN>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi, "$1<REDACTED_TOKEN>")
    .replace(/([?&](?:key|token|secret|api_key)=)[^&#\s]+/gi, "$1<REDACTED>");
}

function redactValue(value, replacements = []) {
  if (typeof value === "string") return redactText(value, replacements);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key, replacements), redactValue(item, replacements)])
    );
  }
  return value;
}

function createSupportBundle(report, options = {}, dependencies = {}) {
  const replacements = [
    [options.workspace ?? report.workspace, "<WORKSPACE>"],
    [options.home, "<HOME>"]
  ].sort((a, b) => String(b[0] || "").length - String(a[0] || "").length);
  const sanitizedReport = redactValue(report, replacements);
  const bundle = {
    schema_version: SUPPORT_SCHEMA_VERSION,
    generated_at: report.generated_at,
    redaction: {
      paths: true,
      credential_values: true,
      environment_values_included: false
    },
    report: sanitizedReport
  };
  const output = path.resolve(options.output);
  if ((dependencies.pathExists ?? defaultPathExists)(output)) {
    throw new UsageError(`output already exists: ${output}`);
  }
  const body = `${JSON.stringify(bundle, null, 2)}\n`;
  const temp = `${output}.${process.pid}.tmp`;
  try {
    (dependencies.writeFile ?? writeFileSync)(temp, body, { encoding: "utf8", flag: "wx" });
    (dependencies.rename ?? renameSync)(temp, output);
  } catch (error) {
    try {
      if ((dependencies.pathExists ?? defaultPathExists)(temp)) (dependencies.unlink ?? unlinkSync)(temp);
    } catch {}
    throw error;
  }
  return {
    ok: true,
    exit_code: 0,
    path: output,
    bytes: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
    summary: report.summary
  };
}

function listFixes() {
  return Object.entries(FIXES).map(([id, fix]) => ({
    id,
    target: fix.target,
    risk: fix.risk,
    summary: fix.summary,
    requires_confirmation: true,
    command_preview: [fix.command, ...fix.args].join(" ")
  }));
}

function defaultRunFixCommand(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = defaultFindExecutables(command, platform, env);
  if (!paths.length) return { ok: false, exitCode: 1, stdout: "", stderr: `${command} was not found on PATH` };
  let executable = paths[0];
  let commandArgs = args;
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    commandArgs = ["/d", "/c", "call", executable, ...args];
    executable = env.ComSpec || process.env.ComSpec || "cmd.exe";
  }
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    env,
    windowsHide: true,
    timeout: options.timeoutMs ?? 10 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
  return {
    ok: result.status === 0 && !result.error,
    exitCode: result.status ?? 1,
    stdout: redactText(result.stdout || ""),
    stderr: redactText(result.stderr || ""),
    error: result.error?.message || null
  };
}

function runFix(id, options = {}, dependencies = {}) {
  const fix = FIXES[id];
  if (!fix) throw new UsageError(`unknown or unsupported fix_id: ${id}`);
  const plan = listFixes().find((item) => item.id === id);
  if (!options.yes) {
    return {
      ok: false,
      exit_code: 2,
      reason: "confirmation_required",
      fix: plan,
      error: `review the command, then rerun with: harness-doctor fix ${id} --yes`
    };
  }
  const result = (dependencies.runCommand ?? defaultRunFixCommand)(fix.command, fix.args, options);
  return {
    ok: result.ok,
    exit_code: result.ok ? 0 : 1,
    reason: result.ok ? "completed" : "failed",
    fix: plan,
    upstream_exit_code: result.exitCode,
    stdout: result.stdout?.trim() || null,
    stderr: result.stderr?.trim() || null,
    error: result.error || (result.ok ? null : `${fix.command} exited with code ${result.exitCode}`)
  };
}

function defaultFindExecutables(command, platform = process.platform, env = process.env) {
  const lookup = platform === "win32" ? "where.exe" : "which";
  const args = platform === "win32" ? [command] : ["-a", command];
  const result = spawnSync(lookup, args, {
    encoding: "utf8",
    env,
    windowsHide: true,
    timeout: DEFAULT_TIMEOUT_MS
  });
  if (result.status !== 0) return [];
  return preferRunnablePaths(
    String(result.stdout || "")
      .split(/\r?\n/)
      .map((value) => value.trim()),
    platform
  );
}

function defaultRunVersion(executable, args, options = {}) {
  const platform = options.platform ?? process.platform;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let command = executable;
  let commandArgs = args;
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    command = process.env.ComSpec || "cmd.exe";
    // Keep the executable and every argument separate. Building one `/s /c` string makes cmd.exe
    // treat the first quoted path as a literal command name on some Windows installations.
    commandArgs = ["/d", "/c", "call", executable, ...args];
  }
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    env: options.env ?? process.env,
    windowsHide: true,
    timeout
  });
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return {
    ok: result.status === 0 && !result.error,
    version: combined.split(/\r?\n/).find(Boolean)?.trim() || null,
    exitCode: result.status,
    error: result.error?.code === "ETIMEDOUT" ? "timeout" : result.error?.message || null
  };
}

function defaultPathExists(value) {
  return existsSync(value);
}

function defaultCountEntries(value) {
  try {
    return readdirSync(value).length;
  } catch {
    return null;
  }
}

function defaultPortOpen(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function check(id, target, status, summary, details = null, fixId = null) {
  return {
    id,
    target,
    status,
    summary,
    details,
    fix_id: fixId
  };
}

function resolveWorkspace(value) {
  const cwd = path.resolve(value || process.cwd());
  if (!existsSync(cwd)) throw new UsageError(`workspace does not exist: ${cwd}`);
  if (!statSync(cwd).isDirectory()) throw new UsageError(`workspace is not a directory: ${cwd}`);
  return cwd;
}

function summarize(checks, strict) {
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const item of checks) summary[item.status] += 1;
  const ok = summary.fail === 0 && (!strict || summary.warn === 0);
  return { ok, exit_code: ok ? 0 : 1, summary };
}

async function runDoctor(options = {}, dependencies = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const targets = options.targets ?? Object.keys(TARGETS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probePorts = options.ports !== false;
  const strict = options.strict === true;
  const findExecutables = dependencies.findExecutables ?? defaultFindExecutables;
  const runVersion = dependencies.runVersion ?? defaultRunVersion;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  const countEntries = dependencies.countEntries ?? defaultCountEntries;
  const portOpen = dependencies.portOpen ?? defaultPortOpen;
  const checks = [];

  const nodePaths = findExecutables("node", platform, env);
  if (!nodePaths.length) {
    checks.push(check("runtime.node", "system", "fail", "Node.js was not found on PATH", null, "install_node"));
  } else {
    const nodeProbe = runVersion(nodePaths[0], ["--version"], { platform, env, timeoutMs });
    checks.push(
      check(
        "runtime.node",
        "system",
        nodeProbe.ok ? "pass" : "fail",
        nodeProbe.ok ? `Node.js ${nodeProbe.version}` : "Node.js exists but version probing failed",
        { path: nodePaths[0], version: nodeProbe.version, error: nodeProbe.error },
        nodeProbe.ok ? null : "repair_node"
      )
    );
    if (targets.includes("dsh") && nodeProbe.ok) {
      const supported = nodeSupportsDsh(nodeProbe.version);
      checks.push(
        check(
          "runtime.node.dsh_compatibility",
          "dsh",
          supported ? "pass" : "fail",
          supported ? "Node.js satisfies DSH requirements" : `DSH requires Node.js ${TARGETS.dsh.nodeRequirement}`,
          { detected: nodeProbe.version, required: TARGETS.dsh.nodeRequirement },
          supported ? null : "upgrade_node_for_dsh"
        )
      );
    }
    if (nodePaths.length > 1) {
      checks.push(
        check(
          "runtime.node.path_duplicates",
          "system",
          "warn",
          `${nodePaths.length} Node.js executables are visible on PATH`,
          { paths: nodePaths },
          "deduplicate_node_path"
        )
      );
    }
  }

  for (const target of targets) {
    const definition = TARGETS[target];
    const paths = findExecutables(definition.command, platform, env);
    if (!paths.length) {
      checks.push(
        check(
          `tool.${target}.command`,
          target,
          "fail",
          `${definition.name} command was not found on PATH`,
          { command: definition.command },
          `install_${target}`
        )
      );
      continue;
    }

    const probe = runVersion(paths[0], definition.versionArgs, { platform, env, timeoutMs });
    checks.push(
      check(
        `tool.${target}.command`,
        target,
        probe.ok ? "pass" : "fail",
        probe.ok ? `${definition.name}: ${probe.version}` : `${definition.name} version probe failed`,
        { path: paths[0], version: probe.version, error: probe.error },
        probe.ok ? null : `repair_${target}`
      )
    );
    if (paths.length > 1) {
      checks.push(
        check(
          `tool.${target}.path_duplicates`,
          target,
          "warn",
          `${paths.length} ${definition.name} commands are visible on PATH`,
          { paths },
          `deduplicate_${target}_path`
        )
      );
    }

    if (definition.credentials.length) {
      const present = definition.credentials.filter((name) => Boolean(env[name]));
      checks.push(
        check(
          `tool.${target}.credentials`,
          target,
          present.length ? "pass" : "warn",
          present.length
            ? `Credential environment is present (${present.join(" or ")})`
            : "No credential environment variable is visible; the harness may use its own credential store",
          { present_names: present, accepted_names: definition.credentials },
          present.length ? null : `configure_${target}_credentials`
        )
      );
    }

    const configPaths = definition.configs.map((relative) => path.join(home, ...relative.split("/")));
    const existingConfigs = configPaths.filter(pathExists);
    checks.push(
      check(
        `tool.${target}.config`,
        target,
        existingConfigs.length ? "pass" : "warn",
        existingConfigs.length ? `${existingConfigs.length} known config path(s) found` : "No known config path was found",
        {
          existing_paths: existingConfigs,
          checked_paths: configPaths,
          entry_counts: Object.fromEntries(existingConfigs.map((value) => [value, countEntries(value)]))
        },
        existingConfigs.length ? null : `configure_${target}`
      )
    );

    if (probePorts) {
      for (const port of definition.ports) {
        const open = await portOpen(port, Math.min(timeoutMs, 1_000));
        checks.push(
          check(
            `tool.${target}.port.${port}`,
            target,
            open ? "pass" : "warn",
            open ? `127.0.0.1:${port} is listening` : `127.0.0.1:${port} is not listening`,
            { host: "127.0.0.1", port, listening: open },
            open ? null : `start_${target}`
          )
        );
      }
    }
  }

  const proxyNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].filter((name) => Boolean(env[name]));
  checks.push(
    check(
      "network.proxy_environment",
      "system",
      proxyNames.length ? "warn" : "pass",
      proxyNames.length ? `Proxy environment is active (${proxyNames.join(", ")})` : "No proxy environment variables are active",
      { present_names: proxyNames },
      proxyNames.length ? "review_proxy_environment" : null
    )
  );

  const outcome = summarize(checks, strict);
  return {
    schema_version: SCHEMA_VERSION,
    ok: outcome.ok,
    exit_code: outcome.exit_code,
    generated_at: new Date().toISOString(),
    mode: "read_only",
    targets,
    workspace: cwd,
    platform: {
      os: platform,
      arch: options.arch ?? process.arch,
      node_version: options.nodeVersion ?? process.versions.node,
      shell_present: Boolean(env.ComSpec || env.SHELL)
    },
    summary: outcome.summary,
    checks
  };
}

function printText(report) {
  process.stdout.write(`Harness Doctor ${VERSION}\n`);
  process.stdout.write(`Targets: ${report.targets.join(", ")}\n\n`);
  const marker = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]" };
  for (const item of report.checks) {
    process.stdout.write(`${marker[item.status]} ${item.id} — ${item.summary}\n`);
  }
  process.stdout.write(`\n${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed\n`);
}

function usageFailure(message, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, exit_code: 2, reason: "invalid_input", error: message })}\n`);
  } else {
    process.stderr.write(`harness-doctor: ${message}\nTry 'harness-doctor --help' for usage.\n`);
  }
  process.exitCode = 2;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseCli(argv);
    if (parsed.help) {
      process.stdout.write(HELP);
      return;
    }
    if (parsed.version) {
      process.stdout.write(`${VERSION}\n`);
      return;
    }
    const cwd = resolveWorkspace(parsed.cwd);
    if (parsed.command === "fixes") {
      if (parsed.positionals.length) throw new UsageError("fixes does not accept positional arguments");
      const result = { ok: true, exit_code: 0, fixes: listFixes() };
      if (parsed.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else for (const fix of result.fixes) process.stdout.write(`${fix.id}\t${fix.risk}\t${fix.command_preview}\n`);
      return;
    }
    if (parsed.command === "fix") {
      if (parsed.positionals.length !== 1) throw new UsageError("fix requires exactly one fix_id");
      const result = runFix(parsed.positionals[0], { ...parsed, cwd });
      if (parsed.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else if (result.ok) process.stdout.write(`Fixed: ${result.fix.id}\n`);
      else process.stderr.write(`harness-doctor: ${result.error}\n`);
      process.exitCode = result.exit_code;
      return;
    }
    if (!new Set(["doctor", "bundle"]).has(parsed.command)) throw new UsageError(`unknown command: ${parsed.command}`);
    if (parsed.positionals.length) throw new UsageError(`${parsed.command} does not accept positional arguments`);
    const report = await runDoctor({ ...parsed, cwd });
    if (parsed.command === "bundle") {
      const stamp = report.generated_at.replace(/[:.]/g, "-");
      const output = parsed.output || path.join(cwd, `harness-support-${stamp}.json`);
      const result = createSupportBundle(report, { output, workspace: cwd, home: os.homedir() });
      if (parsed.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else process.stdout.write(`Support bundle: ${result.path}\nSHA-256: ${result.sha256}\n`);
      return;
    }
    if (parsed.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else printText(report);
    process.exitCode = report.exit_code;
  } catch (error) {
    if (error instanceof UsageError) {
      usageFailure(error.message, parsed?.json ?? argv.includes("--json"));
      return;
    }
    throw error;
  }
}

export {
  VERSION,
  SCHEMA_VERSION,
  SUPPORT_SCHEMA_VERSION,
  TARGETS,
  FIXES,
  UsageError,
  createSupportBundle,
  listFixes,
  main,
  nodeSupportsDsh,
  parseCli,
  parseTargetNames,
  preferRunnablePaths,
  runDoctor,
  runFix,
  summarize
};
