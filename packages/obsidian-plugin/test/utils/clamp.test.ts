import { describe, expect, it } from "vitest";

import {
	clampPythonApiAgentTopK,
	clampPythonApiDefaultTopK,
	clampPythonApiPort,
} from "../../src/utils/clamp.js";

describe("Python clamp helpers", () => {
	it("uses the Python backend fallback port", () => {
		expect(clampPythonApiPort(70000)).toBe(8787);
	});

	it("caps Python retrieval defaults at the API maximum", () => {
		expect(clampPythonApiDefaultTopK(80)).toBe(20);
	});

	it("caps Python agent requests at the agent limit", () => {
		expect(clampPythonApiAgentTopK(80)).toBe(10);
	});
});
