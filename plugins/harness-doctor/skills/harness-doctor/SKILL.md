---
name: harness-doctor
description: Diagnose DeepSeek Harness (dsh), Claude Code, Codex CLI, and OpenClaw installations with the Harness Doctor CLI. Use when commands are missing, Node versions conflict, PATH has duplicates, local harness configuration is unclear, localhost services fail, or the user needs a credential-safe support bundle or an explicitly approved DSH install/repair.
---

# Harness Doctor

Use the published `harness-doctor` CLI as the single diagnostic core. Treat exit code 1 from a scan as a valid report containing failed checks, not as a tool crash.

## Diagnose

1. Confirm the command exists with `harness-doctor --version`.
2. If missing, explain that the pinned install command is:

   ```bash
   npm install -g github:dongsheng123132/harness-doctor#v0.3.1
   ```

   Install it only when the user has authorized installation.
3. Run the smallest relevant target. Prefer the offline scan unless port state matters:

   ```bash
   harness-doctor --target dsh --json --no-ports
   harness-doctor --target all --json --no-ports
   ```

4. Parse `summary`, then report failed and warning checks using only `id`, `target`, `status`, `summary`, and `fix_id`. Do not repeat absolute paths or environment values from `details` unless the user explicitly needs a particular path.
5. Distinguish runtime compatibility from CLI compatibility. DSH requires Node 22.19+ or 24+, while Harness Doctor itself supports Node 20+.

## Support bundle

Choose a new output path and run:

```bash
harness-doctor bundle --target all --output ./harness-support.json --json
```

The bundle redacts home/workspace paths and token-shaped strings and refuses to overwrite an existing file. Report the returned SHA-256. Do not paste the whole bundle into chat unless the user asks.

## Explicit fixes

List the allowlist first:

```bash
harness-doctor fixes --json
```

Never infer a fix or run a blanket repair. Only `install_dsh` and `repair_dsh` are executable. Require the user to approve one exact fix ID, then run:

```bash
harness-doctor fix <fix_id> --yes
```

Do not turn advisory IDs such as Node upgrades, PATH cleanup, proxy review, or credential configuration into automatic mutations.

## Safety

- Never request or print API key values.
- Prefer `--no-ports` for deterministic/offline checks; enable port probing only when localhost service health is relevant.
- Keep scan/bundle read-only. Treat any package installation or repair as a separate, explicitly authorized action.
- Preserve the JSON stdout contract; diagnostics belong on stderr.
