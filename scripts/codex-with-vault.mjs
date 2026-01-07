#!/usr/bin/env node
// Codex launcher with vault writable root
// - avoids editing ~/.codex/config.toml for sandbox_workspace_write.writable_roots

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function usage(exitCode) {
  console.error(
    [
      "Usage:",
      "  node scripts/codex-with-vault.mjs --vault /abs/path/to/Vault [-- <codex args...>]",
      "",
      "Notes:",
      "  - Falls back to AILSS_VAULT_PATH if --vault is omitted.",
      '  - Starts Codex in "workspace-write" mode and allows vault writes via writable_roots.',
    ].join("\n"),
  );
  process.exit(exitCode);
}

function getArgValue(argv, name) {
  const prefix = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === name) return argv[i + 1];
    if (v.startsWith(prefix)) return v.slice(prefix.length);
  }
  return undefined;
}

const argv = process.argv.slice(2);

const maybeVault = getArgValue(argv, "--vault") ?? process.env.AILSS_VAULT_PATH;
if (!maybeVault) usage(2);
if (!path.isAbsolute(maybeVault)) {
  console.error(`Error: --vault must be an absolute path (got: ${maybeVault})`);
  process.exit(2);
}

// Forward everything after `--` (or all args if `--` is omitted, excluding --vault)
const separatorIdx = argv.indexOf("--");
const forwarded =
  separatorIdx === -1
    ? argv.filter((v, i) => !(v === "--vault" && i + 1 < argv.length) && !v.startsWith("--vault="))
    : argv.slice(separatorIdx + 1);

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const writableRootsConfig = `sandbox_workspace_write.writable_roots=["${maybeVault.replaceAll('"', '\\"')}"]`;

const child = spawn(
  "codex",
  ["-C", repoRoot, "--sandbox", "workspace-write", "-c", writableRootsConfig, ...forwarded],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
