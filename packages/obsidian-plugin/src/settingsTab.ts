import { App, PluginSettingTab } from "obsidian";

import type AilssObsidianPlugin from "./main.js";
import type { AilssObsidianSettings } from "./settingsTypes.js";
import { renderAdvancedSection } from "./settingsSections/advancedSection.js";
import { renderAutoIndexSection } from "./settingsSections/autoIndexSection.js";
import { renderIndexMaintenanceSection } from "./settingsSections/indexMaintenanceSection.js";
import { renderMcpServiceSection } from "./settingsSections/mcpServiceSection.js";
import { renderOpenAiSection } from "./settingsSections/openAiSection.js";
import { renderPromptInstallerSection } from "./settingsSections/promptInstallerSection.js";
import type { SettingsSectionContext } from "./settingsSections/sectionContext.js";

export class AilssObsidianSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: AilssObsidianPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderHeader(containerEl);

		const sectionContext = this.getSectionContext();
		renderPromptInstallerSection(containerEl, sectionContext);
		renderOpenAiSection(containerEl, sectionContext);
		renderMcpServiceSection(containerEl, sectionContext);
		renderIndexMaintenanceSection(containerEl, sectionContext);
		renderAutoIndexSection(containerEl, sectionContext);
		renderAdvancedSection(containerEl, sectionContext);
	}

	private renderHeader(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "AILSS Obsidian" });
	}

	private getSectionContext(): SettingsSectionContext {
		return {
			plugin: this.plugin,
			updateSetting: async (key, value) => {
				await this.updateSetting(key, value);
			},
			updateSettingAndRestartMcpIfEnabled: async (key, value) => {
				await this.updateSettingAndRestartMcpIfEnabled(key, value);
			},
		};
	}

	private async updateSetting<K extends keyof AilssObsidianSettings>(
		key: K,
		value: AilssObsidianSettings[K],
	): Promise<void> {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
	}

	private async updateSettingAndRestartMcpIfEnabled<K extends keyof AilssObsidianSettings>(
		key: K,
		value: AilssObsidianSettings[K],
	): Promise<void> {
		await this.updateSetting(key, value);
		if (this.plugin.settings.mcpHttpServiceEnabled) {
			await this.plugin.restartMcpHttpService();
		}
	}
}
