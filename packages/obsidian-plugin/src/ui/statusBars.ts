import { type Plugin } from "obsidian";

import type { AilssIndexerStatusSnapshot } from "../indexer/indexerRunner.js";
import type { AilssMcpHttpServiceStatusSnapshot } from "../mcp/mcpHttpServiceTypes.js";
import { formatAilssTimestampForUi } from "../utils/dateTime.js";

export function mountIndexerStatusBar(
	plugin: Plugin,
	options: { onClick: () => void },
): HTMLElement {
	const el = plugin.addStatusBarItem();
	el.addClass("ailss-obsidian-statusbar");
	el.setAttribute("role", "button");
	el.addEventListener("click", options.onClick);
	plugin.register(() => el.remove());
	return el;
}

export function mountMcpStatusBar(plugin: Plugin, options: { onClick: () => void }): HTMLElement {
	const el = plugin.addStatusBarItem();
	el.addClass("ailss-obsidian-mcp-statusbar");
	el.setAttribute("role", "button");
	el.addEventListener("click", options.onClick);
	plugin.register(() => el.remove());
	return el;
}

export function renderMcpStatusBar(
	el: HTMLElement,
	snapshot: AilssMcpHttpServiceStatusSnapshot,
): void {
	el.removeClass("is-running");
	el.removeClass("is-error");

	if (!snapshot.enabled) {
		el.textContent = "AILSS: MCP Off";
		el.setAttribute("title", "AILSS MCP service is disabled.");
		return;
	}

	if (snapshot.running) {
		el.textContent = "AILSS: MCP Running";
		el.addClass("is-running");
		el.setAttribute("title", ["AILSS MCP service running", snapshot.url].join("\n"));
		return;
	}

	if (snapshot.lastErrorMessage) {
		el.textContent = "AILSS: MCP Error";
		el.addClass("is-error");
		el.setAttribute("title", ["AILSS MCP service error", snapshot.lastErrorMessage].join("\n"));
		return;
	}

	el.textContent = "AILSS: MCP Stopped";
	const lastStoppedAt = formatAilssTimestampForUi(snapshot.lastStoppedAt);
	el.setAttribute(
		"title",
		[
			"AILSS MCP service stopped",
			lastStoppedAt ? `Last stopped: ${lastStoppedAt}` : "",
			snapshot.url,
		]
			.filter(Boolean)
			.join("\n"),
	);
}

export function renderIndexerStatusBar(
	el: HTMLElement,
	snapshot: AilssIndexerStatusSnapshot,
): void {
	el.removeClass("is-running");
	el.removeClass("is-error");

	if (snapshot.running) {
		const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
		const total = snapshot.progress.filesTotal;
		const done = snapshot.progress.filesProcessed;
		const suffix = total ? ` ${Math.min(done, total)}/${total}` : "";
		el.textContent = `AILSS: Indexing${suffix}`;
		el.addClass("is-running");
		el.setAttribute(
			"title",
			[
				"AILSS indexing in progress",
				snapshot.progress.currentFile ? `Current: ${snapshot.progress.currentFile}` : "",
				lastSuccessAt ? `Last success: ${lastSuccessAt}` : "",
			]
				.filter(Boolean)
				.join("\n"),
		);
		return;
	}

	if (snapshot.lastErrorMessage) {
		const lastFinishedAt = formatAilssTimestampForUi(snapshot.lastFinishedAt);
		const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
		el.textContent = "AILSS: Index error";
		el.addClass("is-error");
		el.setAttribute(
			"title",
			[
				"AILSS indexing error",
				lastFinishedAt ? `Last attempt: ${lastFinishedAt}` : "",
				lastSuccessAt ? `Last success: ${lastSuccessAt}` : "",
				snapshot.lastErrorMessage,
			]
				.filter(Boolean)
				.join("\n"),
		);
		return;
	}

	if (snapshot.lastSuccessAt) {
		const lastSuccessAt = formatAilssTimestampForUi(snapshot.lastSuccessAt);
		el.textContent = "AILSS: Ready";
		el.setAttribute("title", `Last success: ${lastSuccessAt ?? snapshot.lastSuccessAt}`);
		return;
	}

	el.textContent = "AILSS: Not indexed";
	el.setAttribute("title", "No successful index run recorded yet.");
}
