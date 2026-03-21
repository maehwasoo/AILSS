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
		text: "Show advanced settings (backend/service/indexer command + args)",
	});
	const advancedContainer = details.createDiv();

	advancedContainer.createEl("h4", { text: "Python backend (local)" });
	new Setting(advancedContainer)
		.setName("Command")
		.setDesc(
			"How to launch the primary local Python backend. If you see 'spawn uv ENOENT', set this to your absolute uv path.",
		)
		.addText((text) => {
			text.setPlaceholder("uv");
			text.setValue(plugin.settings.pythonApiCommand);
			text.onChange(async (value) => {
				await updateSetting(
					"pythonApiCommand",
					value.trim() || DEFAULT_SETTINGS.pythonApiCommand,
				);
			});
		});

	new Setting(advancedContainer)
		.setName("Arguments (one per line)")
		.setDesc(
			[
				"Optional override for the Python backend args.",
				"Leave empty to use the workspace apps/api runner when available.",
				'Example: "run", "--directory", "/absolute/path/to/AILSS-project/apps/api", "ailss-api".',
			].join("\n"),
		)
		.addTextArea((text) => {
			text.setValue(plugin.settings.pythonApiArgs.join("\n"));
			text.onChange(async (value) => {
				await updateSetting("pythonApiArgs", parseArgs(value));
			});
		});

	advancedContainer.createEl("h4", { text: "MCP service (transition layer)" });

	new Setting(advancedContainer)
		.setName("Command")
		.setDesc(
			"How to launch the local MCP service. If you see 'spawn uv ENOENT', set this to your absolute uv path.",
		)
		.addText((text) => {
			text.setPlaceholder("uv");
			text.setValue(plugin.settings.mcpCommand);
			text.onChange(async (value) => {
				await updateSetting("mcpCommand", value.trim() || DEFAULT_SETTINGS.mcpCommand);
			});
		});

	new Setting(advancedContainer)
		.setName("Arguments (one per line)")
		.setDesc(
			[
				"Optional override for the MCP service args.",
				"Leave empty to use the bundled Python apps/api runner when available.",
				'Example: "run", "--directory", "/absolute/path/to/AILSS-project/apps/api", "ailss-mcp-http".',
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
			"How to launch the AILSS indexer (writes <vault>/.ailss/index.sqlite). If you see 'spawn uv ENOENT', set this to your absolute uv path.",
		)
		.addText((text) => {
			text.setPlaceholder("uv");
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
				"Optional override for the indexer args.",
				"Leave empty to use the bundled Python apps/api runner when available.",
				'Example: "run", "--directory", "/absolute/path/to/AILSS-project/apps/api", "ailss-indexer".',
			].join("\n"),
		)
		.addTextArea((text) => {
			text.setValue(plugin.settings.indexerArgs.join("\n"));
			text.onChange(async (value) => {
				await updateSetting("indexerArgs", parseArgs(value));
			});
		});
}
