import { Setting } from "obsidian";
import os from "node:os";
import path from "node:path";

import type { AilssObsidianSettings } from "../settingsTypes.js";
import { type PromptKind } from "../utils/promptTemplates.js";

import type { SettingsSectionContext } from "./sectionContext.js";

const CODEX_SKILL_OPTIONS: Array<{
	id: AilssObsidianSettings["codexSkillId"];
	label: string;
	description: string;
}> = [
	{ id: "ailss-agent", label: "ailss-agent", description: "Core retrieval + safe writes" },
	{
		id: "ailss-agent-ontology",
		label: "ailss-agent-ontology",
		description: "Typed-link ontology decisions",
	},
	{
		id: "ailss-agent-curator",
		label: "ailss-agent-curator",
		description: "Capture and curation workflow",
	},
	{
		id: "ailss-agent-maintenance",
		label: "ailss-agent-maintenance",
		description: "Broken links and migration hygiene",
	},
	{
		id: "ailss-prometheus-agent",
		label: "ailss-prometheus-agent (legacy shim)",
		description: "One-release compatibility shim",
	},
];

function defaultCodexSkillsRootDir(): string {
	return path.join(os.homedir(), ".codex", "skills");
}

export function renderPromptInstallerSection(
	containerEl: HTMLElement,
	{ plugin, updateSetting }: SettingsSectionContext,
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
		.setName("Codex skill")
		.setDesc("Select which skill snapshot to copy/install.")
		.addDropdown((dropdown) => {
			for (const skill of CODEX_SKILL_OPTIONS) {
				dropdown.addOption(skill.id, `${skill.label} - ${skill.description}`);
			}
			dropdown.setValue(plugin.settings.codexSkillId);
			dropdown.onChange(async (value) => {
				await updateSetting("codexSkillId", value as AilssObsidianSettings["codexSkillId"]);
			});
		});

	new Setting(containerEl)
		.setName("Codex skills install root")
		.setDesc(
			[
				"Root path for direct install. The plugin writes to <root>/<skill-name>/SKILL.md.",
				`Default: ${defaultCodexSkillsRootDir()}`,
			].join("\n"),
		)
		.addText((text) => {
			text.setPlaceholder(defaultCodexSkillsRootDir());
			text.setValue(plugin.settings.codexSkillsInstallRootDir);
			text.onChange(async (value) => {
				await updateSetting("codexSkillsInstallRootDir", value.trim());
			});
		});

	new Setting(containerEl)
		.setName("Overwrite existing Codex skill")
		.setDesc("If disabled, install stops when SKILL.md already exists.")
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.codexSkillsInstallOverwrite);
			toggle.onChange(async (value) => {
				await updateSetting("codexSkillsInstallOverwrite", value);
			});
		});

	new Setting(containerEl)
		.setName("Backup before overwrite")
		.setDesc("When overwrite is enabled, keep a timestamped .bak copy of the previous file.")
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.codexSkillsInstallBackup);
			toggle.onChange(async (value) => {
				await updateSetting("codexSkillsInstallBackup", value);
			});
		});

	new Setting(containerEl)
		.setName("Codex skill actions")
		.setDesc(
			[
				"Install writes the selected skill directly to your Codex skills folder.",
				"If install fails, the plugin automatically falls back to clipboard copy.",
				"Note: skill contents are bundled at build time; changes require plugin rebuild + reload.",
			].join("\n"),
		)
		.addButton((button) => {
			button.setButtonText("Install");
			button.setCta();
			button.onClick(() => {
				void plugin.installSelectedCodexSkill();
			});
		})
		.addButton((button) => {
			button.setButtonText("Copy");
			button.onClick(() => {
				void plugin.copySelectedCodexSkillToClipboard();
			});
		});
}
