import fs from "node:fs";
import path from "node:path";

import { fileExists, parseCliArgValue } from "../utils/misc.js";

export function resolveIndexerDbPathForReset(options: {
	vaultPath: string;
	pluginDirRealpathOrNull: string | null;
	indexerArgs: string[];
}): string {
	const fromArgs = parseCliArgValue(options.indexerArgs, "--db");
	if (fromArgs) {
		if (path.isAbsolute(fromArgs)) return fromArgs;
		if (options.pluginDirRealpathOrNull)
			return path.resolve(options.pluginDirRealpathOrNull, fromArgs);
		return path.resolve(fromArgs);
	}

	return path.join(options.vaultPath, ".ailss", "index.sqlite");
}

export async function resetIndexDb(options: {
	dbPath: string;
	clearIndexerHistory: () => void;
	saveSettings: () => Promise<void>;
}): Promise<number> {
	const candidates = [
		options.dbPath,
		`${options.dbPath}-wal`,
		`${options.dbPath}-shm`,
		`${options.dbPath}-journal`,
	];
	const deletedPaths: string[] = [];

	for (const filePath of candidates) {
		try {
			if (!(await fileExists(filePath))) continue;
			await fs.promises.rm(filePath, { force: true });
			deletedPaths.push(filePath);
		} catch {
			// ignore
		}
	}

	options.clearIndexerHistory();
	await options.saveSettings();

	return deletedPaths.length;
}
