import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { formatAilssTimestampForUi } from "./dateTime.js";

export function nowIso(): string {
	return `${new Date().toISOString().slice(0, 19)}Z`;
}

export function appendLimited(existing: string, chunk: string, limit: number): string {
	const next = existing + chunk;
	if (next.length <= limit) return next;
	return next.slice(next.length - limit);
}

export function generateToken(): string {
	return randomBytes(24).toString("hex");
}

export function replaceBasename(filePath: string, fromBase: string, toBase: string): string | null {
	const parsed = path.parse(filePath);
	if (parsed.base !== fromBase) return null;
	return path.join(parsed.dir, toBase);
}

export function formatIndexerLog(input: {
	command: string;
	args: string[];
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}): string {
	const timeIso = nowIso();
	const timeDisplay = formatAilssTimestampForUi(timeIso) ?? timeIso;
	const header = [
		`[time] ${timeDisplay}`,
		`[command] ${input.command} ${input.args.join(" ")}`,
		`[exit] ${input.code ?? "null"}${input.signal ? ` (signal ${input.signal})` : ""}`,
	]
		.filter(Boolean)
		.join("\n");

	return [
		header,
		"",
		"[stdout]",
		input.stdout.trimEnd(),
		"",
		"[stderr]",
		input.stderr.trimEnd(),
		"",
	].join("\n");
}

export function parseCliArgValue(args: string[], key: string): string | null {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] ?? "";
		if (arg === key) {
			const next = args[i + 1];
			return typeof next === "string" ? next : null;
		}

		if (arg.startsWith(`${key}=`)) {
			return arg.slice(key.length + 1);
		}
	}

	return null;
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.stat(filePath);
		return true;
	} catch {
		return false;
	}
}
