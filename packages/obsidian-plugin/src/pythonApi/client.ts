import http from "node:http";

export type PythonApiHealthResponse = {
	status: "ok" | "degraded";
	service: string;
	version: string;
	checks: Record<string, boolean>;
};

export type PythonApiEvalResponse = {
	status: "ok";
	run_id: string;
	dataset_id: string;
	summary: {
		cases_total: number;
		cases_passed: number;
		retrieval_pass_rate: number;
		agent_pass_rate: number;
		latency_ms_p50: number;
		latency_ms_p95: number;
		embedding_prompt_tokens_total?: number | null;
		failure_counts: Record<string, number>;
	};
	artifact_dir?: string | null;
	warnings: string[];
};

export type ShutdownRequestResult = { ok: boolean; status: number | null };

class PythonApiRequestError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message);
	}
}

export async function requestPythonApiHealth(options: {
	host: string;
	port: number;
	timeoutMs?: number;
}): Promise<PythonApiHealthResponse> {
	return await requestJson<PythonApiHealthResponse>({
		host: options.host,
		port: options.port,
		path: "/health",
		method: "GET",
		timeoutMs: options.timeoutMs,
	});
}

export async function runPythonApiEval(options: {
	host: string;
	port: number;
	timeoutMs?: number;
	body?: Record<string, unknown>;
}): Promise<PythonApiEvalResponse> {
	return await requestJson<PythonApiEvalResponse>({
		host: options.host,
		port: options.port,
		path: "/eval/run",
		method: "POST",
		body: options.body ?? {},
		timeoutMs: options.timeoutMs,
	});
}

export async function requestPythonApiShutdown(options: {
	host: string;
	port: number;
	tokens: string[];
	recordError: (message: string) => void;
}): Promise<boolean> {
	const tokens = Array.from(
		new Set(options.tokens.map((token) => token.trim()).filter((token) => token.length > 0)),
	);
	if (tokens.length === 0) return false;

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (!token) continue;

		const result = await requestPythonApiShutdownOnce({
			host: options.host,
			port: options.port,
			token,
			recordError: options.recordError,
		});
		if (result.ok) return true;
		if (result.status === 401 && i < tokens.length - 1) continue;
		return false;
	}

	return false;
}

export async function requestPythonApiShutdownOnce(options: {
	host: string;
	port: number;
	token: string;
	recordError: (message: string) => void;
}): Promise<ShutdownRequestResult> {
	try {
		await requestJson<{ status: "ok" }>({
			host: options.host,
			port: options.port,
			path: "/__ailss/shutdown",
			method: "POST",
			headers: {
				Authorization: `Bearer ${options.token}`,
			},
			timeoutMs: 1_500,
		});
		return { ok: true, status: 200 };
	} catch (error) {
		if (error instanceof PythonApiRequestError) {
			const message =
				error.status === 401
					? "Port is in use and Python shutdown was unauthorized (token mismatch)."
					: error.status === 403
						? "Port is in use and Python shutdown is not configured."
						: error.status === 404
							? "Port is in use and the Python service does not support remote shutdown."
							: `Port is in use and Python shutdown failed (${formatStatus(error.status)}).`;
			options.recordError(error.message ? `${message}\n${error.message}` : message);
			return { ok: false, status: error.status };
		}

		const message = error instanceof Error ? error.message : String(error);
		options.recordError(`Port is in use and Python shutdown request failed: ${message}`);
		return { ok: false, status: null };
	}
}

export async function waitForPythonApiHealth(options: {
	host: string;
	port: number;
	timeoutMs?: number;
	pollIntervalMs?: number;
}): Promise<PythonApiHealthResponse> {
	const timeoutMs = options.timeoutMs ?? 5_000;
	const pollIntervalMs = options.pollIntervalMs ?? 150;
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;

	while (Date.now() < deadline) {
		try {
			return await requestPythonApiHealth({
				host: options.host,
				port: options.port,
				timeoutMs: Math.min(pollIntervalMs, 1_000),
			});
		} catch (error) {
			lastError = error;
			await sleep(pollIntervalMs);
		}
	}

	if (lastError instanceof Error) {
		throw new Error(`Python backend did not become ready in time: ${lastError.message}`);
	}

	throw new Error("Python backend did not become ready in time.");
}

async function requestJson<T>(options: {
	host: string;
	port: number;
	path: string;
	method: "GET" | "POST";
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
}): Promise<T> {
	const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
	const headers: Record<string, string> = { ...(options.headers ?? {}) };
	if (bodyText !== undefined) {
		headers["Content-Type"] = "application/json";
		headers["Content-Length"] = Buffer.byteLength(bodyText, "utf8").toString();
	}

	const response = await requestRaw({
		host: options.host,
		port: options.port,
		path: options.path,
		method: options.method,
		headers,
		bodyText,
		timeoutMs: options.timeoutMs ?? 3_000,
	});

	if (response.status < 200 || response.status >= 300) {
		throw new PythonApiRequestError(
			formatErrorMessage(response.status, response.body),
			response.status,
		);
	}

	if (!response.body.trim()) {
		return {} as T;
	}

	return JSON.parse(response.body) as T;
}

async function requestRaw(options: {
	host: string;
	port: number;
	path: string;
	method: "GET" | "POST";
	headers: Record<string, string>;
	bodyText?: string;
	timeoutMs: number;
}): Promise<{ status: number; body: string }> {
	return await new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: options.host,
				port: options.port,
				path: options.path,
				method: options.method,
				headers: options.headers,
			},
			(res) => {
				res.setEncoding("utf8");

				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					resolve({ status: res.statusCode ?? 0, body });
				});
			},
		);

		req.setTimeout(options.timeoutMs, () => {
			req.destroy(new Error("Request timed out."));
		});

		req.on("error", (error) => {
			const err = error as { message?: string; code?: string };
			const prefix = err.code ? `${err.code}: ` : "";
			reject(new Error(`${prefix}${err.message ?? String(error)}`));
		});

		if (options.bodyText !== undefined) {
			req.write(options.bodyText);
		}
		req.end();
	});
}

function formatErrorMessage(status: number, body: string): string {
	const parsed = tryParseJson(body);
	if (parsed && typeof parsed.detail === "string" && parsed.detail.trim()) {
		return parsed.detail.trim();
	}

	const trimmed = body.trim();
	if (trimmed) return trimmed;
	return `Python API request failed (${formatStatus(status)}).`;
}

function tryParseJson(body: string): { detail?: unknown } | null {
	try {
		return JSON.parse(body) as { detail?: unknown };
	} catch {
		return null;
	}
}

function formatStatus(status: number | null): string {
	return status === null ? "unknown status" : `HTTP ${status}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
