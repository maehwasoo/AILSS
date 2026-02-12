import { Setting } from "obsidian";

import { parseFiniteNumber } from "../settingsParsers.js";
import { DEFAULT_SETTINGS } from "../settingsTypes.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderMcpServiceSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting, updateSettingAndRestartMcpIfEnabled }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "MCP service (Codex, localhost)" });

	new Setting(containerEl)
		.setName("Enable service")
		.setDesc(
			`${plugin.getMcpHttpServiceStatusLine()}\n\nRuns a localhost MCP server for Codex to connect to (URL + token).`,
		)
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.mcpHttpServiceEnabled);
			toggle.onChange(async (value) => {
				await updateSetting("mcpHttpServiceEnabled", value);
				if (value) {
					await plugin.startMcpHttpService();
				} else {
					await plugin.stopMcpHttpService();
				}
			});
		});

	new Setting(containerEl)
		.setName("Port")
		.setDesc("Localhost port for the MCP service (recommended: 31415).")
		.addText((text) => {
			text.setPlaceholder(String(DEFAULT_SETTINGS.mcpHttpServicePort));
			text.setValue(String(plugin.settings.mcpHttpServicePort));
			text.onChange(async (value) => {
				await updateSettingAndRestartMcpIfEnabled(
					"mcpHttpServicePort",
					parseFiniteNumber(value, DEFAULT_SETTINGS.mcpHttpServicePort, {
						integer: true,
					}),
				);
			});
		});

	new Setting(containerEl)
		.setName("Enable write tools over MCP")
		.setDesc("Allows Codex to call write tools like edit_note (still requires apply=true).")
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.mcpHttpServiceEnableWriteTools);
			toggle.onChange(async (value) => {
				await updateSettingAndRestartMcpIfEnabled("mcpHttpServiceEnableWriteTools", value);
			});
		});

	new Setting(containerEl)
		.setName("Token")
		.setDesc("Bearer token required by the localhost service (stored in Obsidian settings).")
		.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("(auto-generated)");
			text.setValue(plugin.settings.mcpHttpServiceToken);
			text.onChange(async (value) => {
				await updateSettingAndRestartMcpIfEnabled("mcpHttpServiceToken", value.trim());
			});
		})
		.addButton((button) => {
			button.setButtonText("Regenerate");
			button.setWarning();
			button.onClick(() => void plugin.regenerateMcpHttpServiceToken());
		});

	new Setting(containerEl)
		.setName("Codex config")
		.setDesc(
			"Copies a ready-to-paste ~/.codex/config.toml block for connecting to this service.",
		)
		.addButton((button) => {
			button.setButtonText("Copy config block");
			button.onClick(() => void plugin.copyCodexMcpConfigBlockToClipboard());
		})
		.addButton((button) => {
			button.setButtonText("Restart service");
			button.onClick(() => void plugin.restartMcpHttpService());
		});
}
