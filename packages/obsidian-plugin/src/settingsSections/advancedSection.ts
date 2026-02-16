import { Setting } from "obsidian";

import { parseArgs } from "../settingsParsers.js";
import { DEFAULT_SETTINGS } from "../settingsTypes.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderAdvancedSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "Advanced (spawn overrides)" });
	const details = containerEl.createEl("details");
	details.createEl("summary", {
		text: "Show advanced settings (server/indexer command + args)",
	});
	const advancedContainer = details.createDiv();
	advancedContainer.createEl("h4", { text: "MCP server (local)" });

	new Setting(advancedContainer)
		.setName("Command")
		.setDesc(
			"How to launch the AILSS MCP server (stdio). If you see 'spawn node ENOENT', set this to your absolute Node path (run 'which node' on macOS/Linux, or 'where node' on Windows).",
		)
		.addText((text) => {
			text.setPlaceholder("node");
			text.setValue(plugin.settings.mcpCommand);
			text.onChange(async (value) => {
				await updateSetting("mcpCommand", value.trim() || DEFAULT_SETTINGS.mcpCommand);
			});
		});

	new Setting(advancedContainer)
		.setName("Arguments (one per line)")
		.setDesc(
			[
				"Optional script path override for the MCP server.",
				"Leave empty to use the bundled service (release zip) when available.",
				'Example: "/absolute/path/to/AILSS-project/packages/mcp/dist/stdio.js" (for command "node").',
			].join("\n"),
		)
		.addTextArea((text) => {
			text.setValue(plugin.settings.mcpArgs.join("\n"));
			text.onChange(async (value) => {
				await updateSetting("mcpArgs", parseArgs(value));
			});
		});

	advancedContainer.createEl("h4", { text: "Indexer (local)" });
	new Setting(advancedContainer)
		.setName("Command")
		.setDesc(
			"How to launch the AILSS indexer (writes <vault>/.ailss/index.sqlite). If you see 'spawn node ENOENT', set this to your absolute Node path (run 'which node' on macOS/Linux, or 'where node' on Windows).",
		)
		.addText((text) => {
			text.setPlaceholder("node");
			text.setValue(plugin.settings.indexerCommand);
			text.onChange(async (value) => {
				await updateSetting(
					"indexerCommand",
					value.trim() || DEFAULT_SETTINGS.indexerCommand,
				);
			});
		});

	new Setting(advancedContainer)
		.setName("Arguments (one per line)")
		.setDesc(
			[
				"Optional script path override for the indexer.",
				"Leave empty to use the bundled service (release zip) when available.",
				'Example: "/absolute/path/to/AILSS-project/packages/indexer/dist/cli.js" (for command "node").',
			].join("\n"),
		)
		.addTextArea((text) => {
			text.setValue(plugin.settings.indexerArgs.join("\n"));
			text.onChange(async (value) => {
				await updateSetting("indexerArgs", parseArgs(value));
			});
		});
}
