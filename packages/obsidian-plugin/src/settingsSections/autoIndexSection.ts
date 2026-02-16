import { Setting } from "obsidian";

import { parseFiniteNumber } from "../settingsParsers.js";
import { DEFAULT_SETTINGS } from "../settingsTypes.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderAutoIndexSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "Auto indexing (optional)" });

	new Setting(containerEl)
		.setName("Enable auto indexing")
		.setDesc("Runs the indexer in the background when markdown notes change (costs money).")
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.autoIndexEnabled);
			toggle.onChange(async (value) => {
				await updateSetting("autoIndexEnabled", value);
			});
		});

	new Setting(containerEl)
		.setName("Debounce (ms)")
		.setDesc("Wait time before indexing after changes (recommended: 2000–10000).")
		.addText((text) => {
			text.setPlaceholder("5000");
			text.setValue(String(plugin.settings.autoIndexDebounceMs));
			text.onChange(async (value) => {
				await updateSetting(
					"autoIndexDebounceMs",
					parseFiniteNumber(value, DEFAULT_SETTINGS.autoIndexDebounceMs),
				);
			});
		});
}
