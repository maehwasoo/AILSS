import { Setting } from "obsidian";

import { parseFiniteNumber } from "../settingsParsers.js";
import { DEFAULT_SETTINGS } from "../settingsTypes.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderPythonApiSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting, updateSettingAndRestartPythonApiIfEnabled }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "Python backend (local)" });

	new Setting(containerEl)
		.setName("Enable backend")
		.setDesc(
			`${plugin.getPythonApiServiceStatusLine()}\n\nRuns the primary local FastAPI runtime for health, retrieval, agent workflow, and eval endpoints.`,
		)
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.pythonApiServiceEnabled);
			toggle.onChange(async (value) => {
				await updateSetting("pythonApiServiceEnabled", value);
				if (value) {
					await plugin.startPythonApiService();
				} else {
					await plugin.stopPythonApiService();
				}
			});
		});

	new Setting(containerEl)
		.setName("Backend port")
		.setDesc("Localhost port for the Python backend (recommended: 8787).")
		.addText((text) => {
			text.setPlaceholder(String(DEFAULT_SETTINGS.pythonApiServicePort));
			text.setValue(String(plugin.settings.pythonApiServicePort));
			text.onChange(async (value) => {
				await updateSettingAndRestartPythonApiIfEnabled(
					"pythonApiServicePort",
					parseFiniteNumber(value, DEFAULT_SETTINGS.pythonApiServicePort, {
						integer: true,
					}),
				);
			});
		});

	new Setting(containerEl)
		.setName("Controls")
		.setDesc("Open status, run health checks, or restart the primary local backend.")
		.addButton((button) => {
			button.setButtonText("Open status");
			button.onClick(() => plugin.openPythonStatusModal());
		})
		.addButton((button) => {
			button.setButtonText("Restart backend");
			button.onClick(() => void plugin.restartPythonApiService());
		});
}
