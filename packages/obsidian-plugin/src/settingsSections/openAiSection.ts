import { Setting } from "obsidian";

import { parseFiniteNumber } from "../settingsParsers.js";
import { DEFAULT_SETTINGS } from "../settingsTypes.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderOpenAiSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting }: SettingsSectionContext,
): void {
	new Setting(containerEl)
		.setName("OpenAI API key")
		.setDesc("Stored locally in Obsidian settings. Required for indexing and MCP queries.")
		.addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("sk-…");
			text.setValue(plugin.settings.openaiApiKey);
			text.onChange(async (value) => {
				await updateSetting("openaiApiKey", value.trim());
			});
		});

	new Setting(containerEl)
		.setName("Embedding model")
		.setDesc("Defaults to text-embedding-3-large.")
		.addDropdown((dropdown) => {
			const supportedModels = ["text-embedding-3-large", "text-embedding-3-small"] as const;

			for (const model of supportedModels) {
				dropdown.addOption(model, model);
			}

			const current =
				plugin.settings.openaiEmbeddingModel.trim() ||
				DEFAULT_SETTINGS.openaiEmbeddingModel;
			const isSupported = supportedModels.includes(
				current as (typeof supportedModels)[number],
			);
			if (!isSupported) dropdown.addOption(current, `${current} (custom)`);

			dropdown.setValue(current);

			dropdown.onChange(async (value) => {
				await updateSetting("openaiEmbeddingModel", value);
			});
		});

	new Setting(containerEl)
		.setName("Top K")
		.setDesc("Default get_context.top_k when the caller omits top_k (1–50).")
		.addText((text) => {
			text.setPlaceholder("10");
			text.setValue(String(plugin.settings.topK));
			text.onChange(async (value) => {
				await updateSetting("topK", parseFiniteNumber(value, DEFAULT_SETTINGS.topK));
			});
		});
}
