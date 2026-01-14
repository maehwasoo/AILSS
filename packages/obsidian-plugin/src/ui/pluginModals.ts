import type AilssObsidianPlugin from "../main.js";

import { AilssIndexerLogModal } from "./indexerLogModal.js";
import { AilssIndexerStatusModal } from "./indexerStatusModal.js";
import { AilssMcpStatusModal } from "./mcpStatusModal.js";

export function openLastIndexerLogModal(plugin: AilssObsidianPlugin): void {
	new AilssIndexerLogModal(plugin.app, plugin).open();
}

export function openIndexerStatusModal(plugin: AilssObsidianPlugin): void {
	new AilssIndexerStatusModal(plugin.app, plugin).open();
}

export function openMcpStatusModal(plugin: AilssObsidianPlugin): void {
	new AilssMcpStatusModal(plugin.app, plugin).open();
}
