import { describe, expect, it, vi } from "vitest";

import { startConfiguredServices } from "../../src/runtime/startConfiguredServices.js";

describe("startConfiguredServices", () => {
	it("starts the Python backend before the MCP transition service", async () => {
		const calls: string[] = [];

		await startConfiguredServices({
			pythonApiServiceEnabled: true,
			mcpHttpServiceEnabled: true,
			startPythonApiService: vi.fn(async () => {
				calls.push("python");
			}),
			startMcpHttpService: vi.fn(async () => {
				calls.push("mcp");
			}),
		});

		expect(calls).toEqual(["python", "mcp"]);
	});

	it("skips disabled services", async () => {
		const startPythonApiService = vi.fn(async () => {});
		const startMcpHttpService = vi.fn(async () => {});

		await startConfiguredServices({
			pythonApiServiceEnabled: false,
			mcpHttpServiceEnabled: true,
			startPythonApiService,
			startMcpHttpService,
		});

		expect(startPythonApiService).not.toHaveBeenCalled();
		expect(startMcpHttpService).toHaveBeenCalledTimes(1);
	});
});
