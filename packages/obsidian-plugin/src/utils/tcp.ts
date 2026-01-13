import * as net from "node:net";

export async function waitForTcpPortToBeAvailable(options: {
	host: string;
	port: number;
	timeoutMs: number;
}): Promise<boolean> {
	const deadline = Date.now() + Math.max(0, options.timeoutMs);

	while (Date.now() < deadline) {
		const available = await canListenTcpPort({ host: options.host, port: options.port });
		if (available) return true;
		await sleep(200);
	}

	return canListenTcpPort({ host: options.host, port: options.port });
}

function canListenTcpPort(options: { host: string; port: number }): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();

		server.once("error", () => {
			resolve(false);
		});

		server.listen(options.port, options.host, () => {
			server.close(() => {
				resolve(true);
			});
		});
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
