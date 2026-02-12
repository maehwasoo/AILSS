import { Setting } from "obsidian";

import { type PromptKind } from "../utils/promptTemplates.js";

import type { SettingsSectionContext } from "./sectionContext.js";

export function renderPromptInstallerSection(
	containerEl: HTMLElement,
	{ plugin }: SettingsSectionContext,
): void {
	containerEl.createEl("h3", { text: "Prompt installer (vault root)" });

	let selectedKind: PromptKind = "AGENTS";
	let overwrite = false;

	new Setting(containerEl)
		.setName("Prompt file")
		.setDesc("Select which prompt file to write at the vault root.")
		.addDropdown((dropdown) => {
			dropdown.addOption("AGENTS", "AGENTS.md");
			dropdown.addOption("CLAUDE", "CLAUDE.md");
			dropdown.addOption("GEMINI", "GEMINI.md");
			dropdown.setValue(selectedKind);
			dropdown.onChange((value) => {
				selectedKind = value as PromptKind;
			});
		});

	new Setting(containerEl)
		.setName("Overwrite existing")
		.setDesc("If enabled, overwrites an existing prompt file at the vault root.")
		.addToggle((toggle) => {
			toggle.setValue(overwrite);
			toggle.onChange((value) => {
				overwrite = value;
			});
		});

	new Setting(containerEl)
		.setName("Install prompt")
		.setDesc(
			[
				"Writes a prompt file at the vault root. These files are meant to steer assistants to use AILSS MCP tools and follow your vault rules.",
				"Note: prompt contents are bundled at build time; changes require plugin rebuild + reload.",
			].join("\n"),
		)
		.addButton((button) => {
			button.setButtonText("Install");
			button.setCta();
			button.onClick(() => {
				void plugin.installVaultRootPrompt({
					kind: selectedKind,
					overwrite,
				});
			});
		});

	new Setting(containerEl)
		.setName("Copy Prometheus Agent skill (Codex)")
		.setDesc(
			[
				"Copies a Codex CLI skill snapshot to your clipboard so you can install it under your Codex skills folder.",
				"Recommended install path: ~/.codex/skills/ailss-prometheus-agent/SKILL.md",
				"Note: skill contents are bundled at build time; changes require plugin rebuild + reload.",
			].join("\n"),
		)
		.addButton((button) => {
			button.setButtonText("Copy");
			button.onClick(() => {
				void plugin.copyCodexPrometheusAgentPromptToClipboard();
			});
		});
}
