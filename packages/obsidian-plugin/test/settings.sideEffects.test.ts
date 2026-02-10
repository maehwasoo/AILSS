import { describe, expect, it, vi } from "vitest";

import type AilssObsidianPlugin from "../src/main.js";
import {
	AilssObsidianSettingTab,
	DEFAULT_SETTINGS,
	type AilssObsidianSettings,
} from "../src/settings.js";
import type { App, ControlRecord, SettingRecord } from "obsidian";
import { getSettingRecords, resetObsidianMockState } from "obsidian";

type PluginStub = {
	settings: AilssObsidianSettings;
	saveSettings: ReturnType<typeof vi.fn>;
	startMcpHttpService: ReturnType<typeof vi.fn>;
	stopMcpHttpService: ReturnType<typeof vi.fn>;
	restartMcpHttpService: ReturnType<typeof vi.fn>;
	getMcpHttpServiceStatusLine: ReturnType<typeof vi.fn>;
	regenerateMcpHttpServiceToken: ReturnType<typeof vi.fn>;
	copyCodexMcpConfigBlockToClipboard: ReturnType<typeof vi.fn>;
	installVaultRootPrompt: ReturnType<typeof vi.fn>;
	copyCodexPrometheusAgentPromptToClipboard: ReturnType<typeof vi.fn>;
	reindexVault: ReturnType<typeof vi.fn>;
	confirmResetIndexDb: ReturnType<typeof vi.fn>;
	openLastIndexerLogModal: ReturnType<typeof vi.fn>;
	saveLastIndexerLogToFile: ReturnType<typeof vi.fn>;
};

type ToggleControl = Extract<ControlRecord, { kind: "toggle" }>;
type TextControl = Extract<ControlRecord, { kind: "text" }>;

function createPluginStub(overrides: Partial<AilssObsidianSettings> = {}): PluginStub {
	return {
		settings: { ...DEFAULT_SETTINGS, ...overrides },
		saveSettings: vi.fn(async () => {}),
		startMcpHttpService: vi.fn(async () => {}),
		stopMcpHttpService: vi.fn(async () => {}),
		restartMcpHttpService: vi.fn(async () => {}),
		getMcpHttpServiceStatusLine: vi.fn(() => "Status: Stopped"),
		regenerateMcpHttpServiceToken: vi.fn(async () => {}),
		copyCodexMcpConfigBlockToClipboard: vi.fn(async () => {}),
		installVaultRootPrompt: vi.fn(async () => {}),
		copyCodexPrometheusAgentPromptToClipboard: vi.fn(async () => {}),
		reindexVault: vi.fn(async () => {}),
		confirmResetIndexDb: vi.fn(() => {}),
		openLastIndexerLogModal: vi.fn(() => {}),
		saveLastIndexerLogToFile: vi.fn(async () => "/tmp/indexer.log"),
	};
}

function renderSettingsTab(overrides: Partial<AilssObsidianSettings> = {}): PluginStub {
	resetObsidianMockState();
	const plugin = createPluginStub(overrides);
	const tab = new AilssObsidianSettingTab({} as App, plugin as unknown as AilssObsidianPlugin);
	tab.display();
	return plugin;
}

function getControl(name: string, kind: ControlRecord["kind"]): ControlRecord {
	const setting = getSettingRecords().find((entry: SettingRecord) => entry.name === name);
	if (!setting) {
		throw new Error(`Setting not found: ${name}`);
	}

	const control = setting.controls.find((entry) => entry.kind === kind);
	if (!control) {
		throw new Error(`Control not found: ${name} (${kind})`);
	}

	return control;
}

async function changeToggle(name: string, value: boolean): Promise<void> {
	const control = getControl(name, "toggle") as ToggleControl;
	await control.onChange?.(value);
}

async function changeText(name: string, value: string): Promise<void> {
	const control = getControl(name, "text") as TextControl;
	await control.onChange?.(value);
}

describe("AilssObsidianSettingTab side effects", () => {
	it("starts MCP service when enable service is turned on", async () => {
		const plugin = renderSettingsTab({ mcpHttpServiceEnabled: false });

		await changeToggle("Enable service", true);

		expect(plugin.settings.mcpHttpServiceEnabled).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.startMcpHttpService).toHaveBeenCalledTimes(1);
		expect(plugin.stopMcpHttpService).not.toHaveBeenCalled();
	});

	it("stops MCP service when enable service is turned off", async () => {
		const plugin = renderSettingsTab({ mcpHttpServiceEnabled: true });

		await changeToggle("Enable service", false);

		expect(plugin.settings.mcpHttpServiceEnabled).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.stopMcpHttpService).toHaveBeenCalledTimes(1);
		expect(plugin.startMcpHttpService).not.toHaveBeenCalled();
	});

	it("restarts MCP service after port change when service is enabled", async () => {
		const plugin = renderSettingsTab({ mcpHttpServiceEnabled: true });

		await changeText("Port", "8080.9");

		expect(plugin.settings.mcpHttpServicePort).toBe(8080);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.restartMcpHttpService).toHaveBeenCalledTimes(1);
	});

	it("does not restart MCP service after port change when service is disabled", async () => {
		const plugin = renderSettingsTab({ mcpHttpServiceEnabled: false });

		await changeText("Port", "not-a-number");

		expect(plugin.settings.mcpHttpServicePort).toBe(DEFAULT_SETTINGS.mcpHttpServicePort);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.restartMcpHttpService).not.toHaveBeenCalled();
	});

	it("restarts MCP service for write-tool and token changes only when enabled", async () => {
		const enabledPlugin = renderSettingsTab({ mcpHttpServiceEnabled: true });

		await changeToggle("Enable write tools over MCP", true);
		await changeText("Token", "  token-value  ");

		expect(enabledPlugin.settings.mcpHttpServiceEnableWriteTools).toBe(true);
		expect(enabledPlugin.settings.mcpHttpServiceToken).toBe("token-value");
		expect(enabledPlugin.restartMcpHttpService).toHaveBeenCalledTimes(2);

		const disabledPlugin = renderSettingsTab({ mcpHttpServiceEnabled: false });

		await changeToggle("Enable write tools over MCP", true);
		await changeText("Token", "  token-value  ");

		expect(disabledPlugin.settings.mcpHttpServiceEnableWriteTools).toBe(true);
		expect(disabledPlugin.settings.mcpHttpServiceToken).toBe("token-value");
		expect(disabledPlugin.restartMcpHttpService).not.toHaveBeenCalled();
	});

	it("persists OpenAI API key changes without MCP lifecycle side effects", async () => {
		const plugin = renderSettingsTab({ mcpHttpServiceEnabled: true });

		await changeText("OpenAI API key", "  sk-test  ");

		expect(plugin.settings.openaiApiKey).toBe("sk-test");
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.startMcpHttpService).not.toHaveBeenCalled();
		expect(plugin.stopMcpHttpService).not.toHaveBeenCalled();
		expect(plugin.restartMcpHttpService).not.toHaveBeenCalled();
	});
});
