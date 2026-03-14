import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	requestPythonApiHealth,
	requestPythonApiRetrieve,
	requestPythonApiShutdownOnce,
	runPythonApiAgent,
	runPythonApiEval,
	waitForPythonApiHealth,
} from "../../src/pythonApi/client.js";

type TestServer = {
	host: string;
	port: number;
	close: () => Promise<void>;
};

async function startServer(
	handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
): Promise<TestServer> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to resolve test server address.");
	}

	return {
		host: "127.0.0.1",
		port: address.port,
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};
}

describe("Python API HTTP client", () => {
	const servers: TestServer[] = [];

	afterEach(async () => {
		while (servers.length > 0) {
			const server = servers.pop();
			if (server) {
				await server.close();
			}
		}
	});

	it("requests Python backend health", async () => {
		const server = await startServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "ok",
					service: "ailss-api",
					version: "0.1.0-dev",
					checks: {
						vault_configured: true,
						db_configured: true,
					},
				}),
			);
		});
		servers.push(server);

		await expect(
			requestPythonApiHealth({ host: server.host, port: server.port }),
		).resolves.toMatchObject({
			status: "ok",
			service: "ailss-api",
			checks: { vault_configured: true },
		});
	});

	it("runs Python eval and parses the summary", async () => {
		const server = await startServer(async (req, res) => {
			expect(req.method).toBe("POST");
			expect(req.url).toBe("/eval/run");

			let body = "";
			for await (const chunk of req) {
				body += chunk.toString();
			}
			expect(body).toBe("{}");

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "ok",
					run_id: "run-123",
					dataset_id: "golden-local-baseline",
					summary: {
						cases_total: 4,
						cases_passed: 3,
						retrieval_pass_rate: 0.75,
						agent_pass_rate: 0.75,
						latency_ms_p50: 12.5,
						latency_ms_p95: 30.1,
						failure_counts: { grounding_failure: 1 },
					},
					artifact_dir: "/tmp/evals/run-123",
					warnings: [],
				}),
			);
		});
		servers.push(server);

		const response = await runPythonApiEval({
			host: server.host,
			port: server.port,
			body: {},
		});

		expect(response.summary.cases_total).toBe(4);
		expect(response.summary.failure_counts.grounding_failure).toBe(1);
		expect(response.artifact_dir).toBe("/tmp/evals/run-123");
	});

	it("requests Python retrieval and parses grounded results", async () => {
		const server = await startServer(async (req, res) => {
			expect(req.method).toBe("POST");
			expect(req.url).toBe("/retrieve");

			let body = "";
			for await (const chunk of req) {
				body += chunk.toString();
			}
			expect(JSON.parse(body)).toEqual({
				query: "python backend",
				top_k: 3,
				path_prefix: "docs/",
			});

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "ok",
					query: "python backend",
					mode: "semantic_local",
					results: [
						{
							path: "docs/03-plan.md",
							title: "Plan",
							snippet: "Python-first backend direction.",
							evidence: [
								{
									chunk_id: "docs-03-plan-0",
									text: "Python-first backend direction.",
									score: 0.91,
								},
							],
						},
					],
					warnings: [],
					usage: {
						latency_ms: 12.4,
						used_chunks_k: 3,
						embedding_model: "text-embedding-3-large",
						embedding_prompt_tokens: 7,
					},
				}),
			);
		});
		servers.push(server);

		const response = await requestPythonApiRetrieve({
			host: server.host,
			port: server.port,
			body: {
				query: "python backend",
				top_k: 3,
				path_prefix: "docs/",
			},
		});

		expect(response.mode).toBe("semantic_local");
		expect(response.results[0]?.path).toBe("docs/03-plan.md");
		expect(response.usage.embedding_prompt_tokens).toBe(7);
	});

	it("runs Python agent and parses answer plus citations", async () => {
		const server = await startServer(async (req, res) => {
			expect(req.method).toBe("POST");
			expect(req.url).toBe("/agent/run");

			let body = "";
			for await (const chunk of req) {
				body += chunk.toString();
			}
			expect(JSON.parse(body)).toEqual({
				input: "Summarize the Python backend direction.",
				context: {
					top_k: 2,
					path_prefix: "docs/",
				},
			});

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "ok",
					run_id: "run-123",
					outcome: "completed",
					answer: "AILSS is moving toward a Python-first local agent backend.",
					citations: [
						{
							path: "docs/03-plan.md",
							chunk_id: "docs-03-plan-0",
						},
					],
					workflow: [
						{ name: "validate", outcome: "completed", detail: "1 citations attached" },
					],
					write_actions: [],
					metrics: {
						latency_ms: 21.5,
						retrieval_latency_ms: 10.2,
						retrieval_mode: "semantic_local",
						selected_notes: 1,
						embedding_prompt_tokens: 7,
					},
					artifact_path: "/tmp/runs/run-123.json",
				}),
			);
		});
		servers.push(server);

		const response = await runPythonApiAgent({
			host: server.host,
			port: server.port,
			body: {
				input: "Summarize the Python backend direction.",
				context: {
					top_k: 2,
					path_prefix: "docs/",
				},
			},
		});

		expect(response.outcome).toBe("completed");
		expect(response.citations[0]?.path).toBe("docs/03-plan.md");
		expect(response.metrics.selected_notes).toBe(1);
	});

	it("retries health polling until the backend becomes ready", async () => {
		let attempts = 0;
		const server = await startServer((_req, res) => {
			attempts += 1;
			if (attempts < 3) {
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ detail: "warming up" }));
				return;
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "degraded",
					service: "ailss-api",
					version: "0.1.0-dev",
					checks: {
						vault_configured: true,
						db_configured: true,
					},
				}),
			);
		});
		servers.push(server);

		const response = await waitForPythonApiHealth({
			host: server.host,
			port: server.port,
			timeoutMs: 2_000,
			pollIntervalMs: 50,
		});

		expect(response.status).toBe("degraded");
		expect(attempts).toBe(3);
	});

	it("returns structured shutdown failure information", async () => {
		const recordError = vi.fn();
		const server = await startServer((req, res) => {
			expect(req.headers.authorization).toBe("Bearer wrong-token");
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ detail: "Invalid shutdown token." }));
		});
		servers.push(server);

		const result = await requestPythonApiShutdownOnce({
			host: server.host,
			port: server.port,
			token: "wrong-token",
			recordError,
		});

		expect(result).toEqual({ ok: false, status: 401 });
		expect(recordError).toHaveBeenCalledWith(
			"Port is in use and Python shutdown was unauthorized (token mismatch).\nInvalid shutdown token.",
		);
	});
});
