import fs from "node:fs";
import path from "node:path";

export async function saveLastIndexerLogToFile(options: {
	vaultPath: string;
	log: string;
}): Promise<string> {
	const log = options.log.trim();
	if (!log) throw new Error("No indexer log available.");

	const dir = path.join(options.vaultPath, ".ailss");
	await fs.promises.mkdir(dir, { recursive: true });

	const filePath = path.join(dir, "ailss-indexer-last.log");
	await fs.promises.writeFile(filePath, log + "\n", "utf8");
	return filePath;
}
