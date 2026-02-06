import type { AilssObsidianSettings } from "../settings.js";

export type AilssObsidianPluginDataV1 = {
	version: 1;
	settings: Partial<AilssObsidianSettings>;
	indexer: {
		lastSuccessAt: string | null;
	};
};

export function normalizeAilssPluginDataV1(
	data: AilssObsidianPluginDataV1,
): AilssObsidianPluginDataV1 {
	return {
		version: 1,
		settings: data.settings,
		indexer: { lastSuccessAt: data.indexer.lastSuccessAt ?? null },
	};
}

export function parseAilssPluginData(raw: unknown): {
	settings: Partial<AilssObsidianSettings>;
	indexer: { lastSuccessAt: string | null };
} {
	const empty = { settings: {}, indexer: { lastSuccessAt: null } };

	if (!isRecord(raw)) return empty;

	// v1 shape
	if (raw.version === 1 && isRecord(raw.settings)) {
		const settings = { ...(raw.settings as Record<string, unknown>) };
		delete settings.mcpOnlyMode;
		delete settings.codexOnlyMode;

		const indexer = isRecord(raw.indexer) ? raw.indexer : {};
		return {
			settings: settings as Partial<AilssObsidianSettings>,
			indexer: {
				lastSuccessAt:
					typeof indexer.lastSuccessAt === "string" ? indexer.lastSuccessAt : null,
			},
		};
	}

	// Legacy shape: settings object stored at the root
	const legacySettings = { ...(raw as Record<string, unknown>) };
	delete legacySettings.mcpOnlyMode;
	delete legacySettings.codexOnlyMode;

	return {
		settings: legacySettings as Partial<AilssObsidianSettings>,
		indexer: { lastSuccessAt: null },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
