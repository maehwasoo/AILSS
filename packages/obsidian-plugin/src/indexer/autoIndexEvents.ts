import { TFile, type Plugin } from "obsidian";

import type { AutoIndexScheduler } from "./autoIndexScheduler.js";

type AutoIndexEventsAutoIndex = Pick<AutoIndexScheduler, "enqueue" | "dispose">;

export function registerAutoIndexEvents(plugin: Plugin, autoIndex: AutoIndexEventsAutoIndex): void {
	plugin.registerEvent(
		plugin.app.vault.on("create", (file: unknown) => {
			if (!(file instanceof TFile)) return;
			autoIndex.enqueue(file.path);
		}),
	);

	plugin.registerEvent(
		plugin.app.vault.on("modify", (file: unknown) => {
			if (!(file instanceof TFile)) return;
			autoIndex.enqueue(file.path);
		}),
	);

	plugin.registerEvent(
		plugin.app.vault.on("delete", (file: unknown) => {
			if (!(file instanceof TFile)) return;
			autoIndex.enqueue(file.path);
		}),
	);

	plugin.registerEvent(
		plugin.app.vault.on("rename", (file: unknown, oldPath: unknown) => {
			if (!(file instanceof TFile)) return;
			if (typeof oldPath === "string") autoIndex.enqueue(oldPath);
			autoIndex.enqueue(file.path);
		}),
	);

	plugin.register(() => autoIndex.dispose());
}
