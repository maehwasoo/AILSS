import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { appendLimited } from "./misc.js";

type SpawnOptions = { cwd?: string; env: NodeJS.ProcessEnv };

type SpawnHandlers = {
	onStdoutChunk?: (chunk: string) => void;
	onStderrChunk?: (chunk: string) => void;
};

type SpawnCaptureResult = {
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

export async function spawnAndCapture(
	command: string,
	args: string[],
	options: SpawnOptions,
	handlers?: SpawnHandlers,
): Promise<SpawnCaptureResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const limit = 80_000;
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: unknown) => {
			const text = typeof chunk === "string" ? chunk : String(chunk);
			stdout = appendLimited(stdout, text, limit);
			handlers?.onStdoutChunk?.(text);
		});
		child.stderr?.on("data", (chunk: unknown) => {
			const text = typeof chunk === "string" ? chunk : String(chunk);
			stderr = appendLimited(stderr, text, limit);
			handlers?.onStderrChunk?.(text);
		});

		child.on("error", (error) => {
			reject(enhanceSpawnError(error, command, options.env));
		});
		child.on("close", (code, signal) => {
			resolve({ code, signal, stdout, stderr });
		});
	});
}

export function resolveSpawnCommandAndEnv(
	command: string,
	env: NodeJS.ProcessEnv,
): { command: string; env: NodeJS.ProcessEnv } {
	const normalizedEnv = normalizeSpawnEnv(env);
	if (command !== "node") return { command, env: normalizedEnv };
	if (looksLikePath(command)) return { command, env: normalizedEnv };

	const resolvedNode = resolveNodeExecutable(normalizedEnv);
	if (resolvedNode) return { command: resolvedNode, env: normalizedEnv };

	return { command, env: normalizedEnv };
}

function normalizeSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const normalized: NodeJS.ProcessEnv = { ...env };

	const existingPath = readEnvPath(normalized);
	const extra = defaultExtraPathEntries();
	const merged = mergePathEntries(existingPath, extra);

	normalized.PATH = merged;
	if (typeof normalized["Path"] === "string") normalized["Path"] = merged;

	return normalized;
}

function readEnvPath(env: NodeJS.ProcessEnv): string {
	const candidate = env.PATH ?? env["Path"];
	return typeof candidate === "string" ? candidate : "";
}

function defaultExtraPathEntries(): string[] {
	// Common Node install locations
	if (process.platform === "darwin") {
		return ["/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin"];
	}

	if (process.platform === "linux") {
		return ["/usr/local/bin", "/usr/bin"];
	}

	return [];
}

function mergePathEntries(existing: string, extra: string[]): string {
	const delimiter = path.delimiter;
	const existingParts = existing
		.split(delimiter)
		.map((p) => p.trim())
		.filter(Boolean);

	const seen = new Set<string>(existingParts.map((p) => normalizePathKey(p)));
	const merged = [...existingParts];
	for (const entry of extra) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const key = normalizePathKey(trimmed);
		if (seen.has(key)) continue;
		merged.push(trimmed);
		seen.add(key);
	}

	return merged.join(delimiter);
}

function normalizePathKey(p: string): string {
	return process.platform === "win32" ? p.toLowerCase() : p;
}

function looksLikePath(command: string): boolean {
	return command.includes("/") || command.includes("\\");
}

function resolveNodeExecutable(env: NodeJS.ProcessEnv): string | null {
	const fromPath = findExecutableInEnvPath("node", env);
	if (fromPath) return fromPath;

	for (const candidate of knownNodeExecutablePaths(env)) {
		if (isExecutableFile(candidate)) return candidate;
	}

	const nvmNode = resolveNodeFromNvm(env);
	if (nvmNode) return nvmNode;

	return null;
}

function knownNodeExecutablePaths(env: NodeJS.ProcessEnv): string[] {
	if (process.platform === "darwin") {
		return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/opt/local/bin/node"];
	}

	if (process.platform === "linux") {
		return ["/usr/local/bin/node", "/usr/bin/node"];
	}

	if (process.platform === "win32") {
		const candidates: string[] = [];
		const programFiles = env.ProgramFiles;
		const programFilesX86 = env["ProgramFiles(x86)"];
		if (programFiles) candidates.push(path.join(programFiles, "nodejs", "node.exe"));
		if (programFilesX86) candidates.push(path.join(programFilesX86, "nodejs", "node.exe"));
		return candidates;
	}

	return [];
}

function findExecutableInEnvPath(command: string, env: NodeJS.ProcessEnv): string | null {
	const pathValue = readEnvPath(env);
	if (!pathValue) return null;

	const dirs = pathValue
		.split(path.delimiter)
		.map((p) => p.trim())
		.filter(Boolean);

	const candidates =
		process.platform === "win32" ? windowsCommandCandidates(command, env) : [command];
	for (const dir of dirs) {
		for (const file of candidates) {
			const full = path.join(dir, file);
			if (isExecutableFile(full)) return full;
		}
	}

	return null;
}

function windowsCommandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
	// PATHEXT-based candidates
	if (path.extname(command)) return [command];

	const pathext = typeof env.PATHEXT === "string" ? env.PATHEXT : ".EXE;.CMD;.BAT;.COM";
	const exts = pathext
		.split(";")
		.map((e) => e.trim())
		.filter(Boolean);

	return exts.map((ext) => command + ext.toLowerCase());
}

function isExecutableFile(filePath: string): boolean {
	try {
		const stat = fs.statSync(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}

function resolveNodeFromNvm(env: NodeJS.ProcessEnv): string | null {
	const home = env.HOME ?? env.USERPROFILE;
	const nvmDir = env.NVM_DIR ?? (home ? path.join(home, ".nvm") : undefined);
	if (!nvmDir) return null;

	const aliasDefault = path.join(nvmDir, "alias", "default");
	const pinned = tryReadNvmVersionAlias(aliasDefault);
	if (pinned) {
		const candidate = path.join(nvmDir, "versions", "node", pinned, "bin", "node");
		if (isExecutableFile(candidate)) return candidate;
	}

	const versionsDir = path.join(nvmDir, "versions", "node");
	const best = findBestNvmInstalledNodeVersion(versionsDir);
	if (!best) return null;

	const candidate = path.join(versionsDir, best, "bin", "node");
	return isExecutableFile(candidate) ? candidate : null;
}

function tryReadNvmVersionAlias(filePath: string): string | null {
	try {
		const raw = fs.readFileSync(filePath, "utf8").trim();
		if (!raw) return null;
		// nvm stores versions like "v20.11.0"
		return /^v\\d+\\.\\d+\\.\\d+$/.test(raw) ? raw : null;
	} catch {
		return null;
	}
}

function findBestNvmInstalledNodeVersion(versionsDir: string): string | null {
	try {
		const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
		const versions = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.filter((name) => /^v\\d+\\.\\d+\\.\\d+$/.test(name));

		if (versions.length === 0) return null;

		versions.sort((a, b) => compareSemverDesc(a, b));
		return versions[0] ?? null;
	} catch {
		return null;
	}
}

function compareSemverDesc(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return 0;

	if (pa[0] !== pb[0]) return pb[0] - pa[0];
	if (pa[1] !== pb[1]) return pb[1] - pa[1];
	return pb[2] - pa[2];
}

function parseSemver(v: string): [number, number, number] | null {
	const match = /^v?(\\d+)\\.(\\d+)\\.(\\d+)$/.exec(v.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function toStringEnvRecord(env: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

function enhanceSpawnError(error: unknown, command: string, env: NodeJS.ProcessEnv): Error {
	if (isErrnoException(error) && error.code === "ENOENT") {
		const pathValue = readEnvPath(env);
		const base = `Failed to start process: ${command} (ENOENT: not found).`;

		if (path.basename(command) === "node" || path.basename(command) === "node.exe") {
			return new Error(
				`${base}\n\n${nodeNotFoundMessage("Indexer")}\n\nPATH=${pathValue || "<empty>"}`,
			);
		}

		return new Error(`${base}\n\nPATH=${pathValue || "<empty>"}`);
	}

	return error instanceof Error ? error : new Error(String(error));
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		!!error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	);
}

export function nodeNotFoundMessage(kind: "MCP" | "Indexer"): string {
	const locateCommand = process.platform === "win32" ? "where node" : "which node";
	const examples = nodePathExamplesByPlatform();
	const hint = examples.length > 0 ? `Common paths: ${examples.join(", ")}` : "";

	return [
		`Could not find a Node.js executable for the ${kind} command.`,
		"Obsidian may not inherit your shell PATH (especially on macOS).",
		`Fix: Settings → Community plugins → AILSS Obsidian → ${kind} → Command: set it to your absolute Node path (from running '${locateCommand}' in your terminal).`,
		hint,
	]
		.filter(Boolean)
		.join("\n");
}

function nodePathExamplesByPlatform(): string[] {
	if (process.platform === "darwin") return ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
	if (process.platform === "linux") return ["/usr/bin/node", "/usr/local/bin/node"];
	if (process.platform === "win32") return ["C:\\\\Program Files\\\\nodejs\\\\node.exe"];
	return [];
}
