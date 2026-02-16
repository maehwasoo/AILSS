import fs from "node:fs";
import path from "node:path";

import { nowIso } from "../../utils/misc.js";

export const MCP_HTTP_LOG_DIR = ".ailss";
export const MCP_HTTP_LOG_FILE = "ailss-mcp-http-last.log";

export function enqueueDurableLogWrite(
	queue: Promise<void>,
	task: () => Promise<void>,
): Promise<void> {
	return queue.then(task).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[ailss-mcp-http] durable log write failed: ${message}`);
	});
}

export function initializeDurableLog(options: {
	vaultPath: string;
	durableLogWriteQueue: Promise<void>;
}): { durableLogPath: string | null; durableLogWriteQueue: Promise<void> } {
	const vaultPath = options.vaultPath.trim();
	if (!vaultPath) {
		return {
			durableLogPath: null,
			durableLogWriteQueue: options.durableLogWriteQueue,
		};
	}

	const dir = path.join(vaultPath, MCP_HTTP_LOG_DIR);
	const filePath = path.join(dir, MCP_HTTP_LOG_FILE);
	const header = [`[time] ${nowIso()}`, "[event] mcp-http-service-start", ""].join("\n");

	return {
		durableLogPath: filePath,
		durableLogWriteQueue: enqueueDurableLogWrite(options.durableLogWriteQueue, async () => {
			await fs.promises.mkdir(dir, { recursive: true });
			await fs.promises.writeFile(filePath, header, "utf8");
		}),
	};
}

export function appendDurableLogChunk(options: {
	durableLogPath: string | null;
	durableLogWriteQueue: Promise<void>;
	stream: "stdout" | "stderr";
	chunk: string;
}): { durableLogWriteQueue: Promise<void> } {
	const filePath = options.durableLogPath;
	if (!filePath || !options.chunk) {
		return { durableLogWriteQueue: options.durableLogWriteQueue };
	}

	const content = options.chunk.trimEnd();
	if (!content) {
		return { durableLogWriteQueue: options.durableLogWriteQueue };
	}

	const entry = [`[time] ${nowIso()}`, `[stream] ${options.stream}`, content, ""].join("\n");
	return {
		durableLogWriteQueue: enqueueDurableLogWrite(options.durableLogWriteQueue, async () => {
			await fs.promises.appendFile(filePath, entry, "utf8");
		}),
	};
}
