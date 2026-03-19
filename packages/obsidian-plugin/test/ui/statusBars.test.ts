import { describe, expect, it } from "vitest";

import { renderPythonStatusBar } from "../../src/ui/statusBars.js";

type MockElement = {
	textContent: string;
	attributes: Map<string, string>;
	classes: Set<string>;
	setAttribute: (name: string, value: string) => void;
	addClass: (name: string) => void;
	removeClass: (name: string) => void;
};

function createElement(): MockElement {
	return {
		textContent: "",
		attributes: new Map(),
		classes: new Set(),
		setAttribute(name: string, value: string) {
			this.attributes.set(name, value);
		},
		addClass(name: string) {
			this.classes.add(name);
		},
		removeClass(name: string) {
			this.classes.delete(name);
		},
	};
}

describe("renderPythonStatusBar", () => {
	it("renders the running backend as the primary runtime", () => {
		const el = createElement();

		renderPythonStatusBar(el as unknown as HTMLElement, {
			enabled: true,
			url: "http://127.0.0.1:8787",
			running: true,
			startedAt: "2026-03-19T00:00:00.000Z",
			lastExitCode: null,
			lastStoppedAt: null,
			lastErrorMessage: null,
		});

		expect(el.textContent).toBe("AILSS: backend running");
		expect(el.classes.has("is-running")).toBe(true);
		expect(el.attributes.get("title")).toContain("AILSS Python backend running");
	});

	it("renders backend errors ahead of stopped state", () => {
		const el = createElement();

		renderPythonStatusBar(el as unknown as HTMLElement, {
			enabled: true,
			url: "http://127.0.0.1:8787",
			running: false,
			startedAt: null,
			lastExitCode: 1,
			lastStoppedAt: "2026-03-19T00:00:00.000Z",
			lastErrorMessage: "Readiness check failed",
		});

		expect(el.textContent).toBe("AILSS: backend error");
		expect(el.classes.has("is-error")).toBe(true);
		expect(el.attributes.get("title")).toContain("Readiness check failed");
	});
});
