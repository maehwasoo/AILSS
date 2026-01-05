import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type AilssSemanticSearchHit = {
	path: string;
	heading: string | null;
	heading_path: string[];
	distance: number;
	snippet: string;
};

export type AilssMcpSpawnConfig = {
	command: string;
	args: string[];
	cwd?: string;
	env: Record<string, string>;
};

export class AilssMcpClient {
	private readonly client: Client;
	private transport: StdioClientTransport | null = null;

	constructor(private readonly spawn: AilssMcpSpawnConfig) {
		this.client = new Client({ name: "ailss-obsidian", version: "0.1.0" });
	}

	async connect(): Promise<void> {
		if (this.transport) return;

		const transport = new StdioClientTransport({
			command: this.spawn.command,
			args: this.spawn.args,
			env: this.spawn.env,
			stderr: "pipe",
			...(this.spawn.cwd ? { cwd: this.spawn.cwd } : {}),
		});

		this.transport = transport;
		await this.client.connect(transport);

		// Tool metadata caching
		await this.client.listTools({});
	}

	async semanticSearch(query: string, topK: number): Promise<AilssSemanticSearchHit[]> {
		await this.connect();

		const result = await this.client.callTool({
			name: "semantic_search",
			arguments: { query, top_k: topK },
		});

		const payload = readFirstTextContent(result.content);
		const parsed = safeJsonParse(payload);
		if (!parsed || typeof parsed !== "object") return [];

		const results = (parsed as { results?: unknown }).results;
		if (!Array.isArray(results)) return [];

		return results
			.map((row) => normalizeSearchHit(row))
			.filter((hit): hit is AilssSemanticSearchHit => hit !== null);
	}

	async close(): Promise<void> {
		try {
			await this.client.close();
		} finally {
			if (this.transport) {
				await this.transport.close();
				this.transport = null;
			}
		}
	}
}

function readFirstTextContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const first = content[0] as { type?: unknown; text?: unknown } | undefined;
	if (!first) return "";
	if (first.type !== "text") return "";
	return typeof first.text === "string" ? first.text : "";
}

function safeJsonParse(text: string): unknown | null {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function normalizeSearchHit(row: unknown): AilssSemanticSearchHit | null {
	if (!row || typeof row !== "object") return null;
	const obj = row as Record<string, unknown>;

	const path = typeof obj.path === "string" ? obj.path : "";
	if (!path) return null;

	const heading = typeof obj.heading === "string" ? obj.heading : null;
	const distance = typeof obj.distance === "number" ? obj.distance : NaN;
	const snippet = typeof obj.snippet === "string" ? obj.snippet : "";

	const heading_path_raw = obj.heading_path;
	const heading_path = Array.isArray(heading_path_raw)
		? heading_path_raw.filter((v): v is string => typeof v === "string")
		: [];

	return { path, heading, heading_path, distance, snippet };
}
