import type AilssObsidianPlugin from "../main.js";
import type { AilssObsidianSettings } from "../settingsTypes.js";

export type SettingUpdater = <K extends keyof AilssObsidianSettings>(
	key: K,
	value: AilssObsidianSettings[K],
) => Promise<void>;

export type SettingsSectionContext = {
	plugin: AilssObsidianPlugin;
	updateSetting: SettingUpdater;
	updateSettingAndRestartMcpIfEnabled: SettingUpdater;
};
