import http from "node:http";

export type ShutdownRequestResult = { ok: boolean; status: number | null };

export async function requestShutdown(options: {
	host: string;
	port: number;
	tokens: string[];
	requestShutdownOnce: (options: {
		host: string;
		port: number;
		token: string;
	}) => Promise<ShutdownRequestResult>;
}): Promise<boolean> {
	const tokens = Array.from(
		new Set(options.tokens.map((t) => t.trim()).filter((t) => t.length > 0)),
	);
	if (tokens.length === 0) return false;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token) continue;

		const res = await options.requestShutdownOnce({
			host: options.host,
			port: options.port,
			token,
		});

		if (res.ok) return true;
		if (res.status === 401 && i < tokens.length - 1) continue;
		return false;
	}

	return false;
}

export async function requestShutdownOnce(options: {
	host: string;
	port: number;
	token: string;
	recordError: (message: string) => void;
}): Promise<ShutdownRequestResult> {
	// Use Node's HTTP client instead of `fetch` to avoid CORS/preflight issues in the
	// Obsidian renderer context.
	return await new Promise<ShutdownRequestResult>((resolve) => {
		let settled = false;

		const finish = (ok: boolean, status: number | null, errorMessage?: string) => {
			if (settled) return;
			settled = true;

			if (errorMessage) {
				options.recordError(errorMessage);
			}

			resolve({ ok, status });
		};

		const req = http.request(
			{
				hostname: options.host,
				port: options.port,
				path: "/__ailss/shutdown",
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.token}`,
				},
			},
			(res) => {
				res.setEncoding("utf8");

				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
				});

				res.on("end", () => {
					const status = res.statusCode ?? 0;
					if (status >= 200 && status < 300) {
						finish(true, status);
						return;
					}

					const message =
						status === 401
							? "Port is in use and shutdown was unauthorized (token mismatch)."
							: status === 404
								? "Port is in use and the service does not support remote shutdown."
								: `Port is in use and shutdown failed (HTTP ${status}).`;
					const detail = body.trim();
					finish(false, status, detail ? `${message}\n${detail}` : message);
				});
			},
		);

		req.setTimeout(1_500, () => {
			req.destroy(new Error("Request timed out."));
		});

		req.on("error", (error) => {
			const e = error as { message?: string; code?: string };
			const suffix = e.code ? `${e.code}: ` : "";
			const message = `${suffix}${e.message ?? String(error)}`;
			finish(false, null, `Port is in use and shutdown request failed: ${message}`);
		});

		req.end();
	});
}
