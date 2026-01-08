import { DEFAULT_SETTINGS } from "../settings.js";

export function clampTopK(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.topK);
	if (n < 1) return 1;
	if (n > 50) return 50;
	return n;
}

export function clampPort(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.mcpHttpServicePort);
	if (n < 1) return DEFAULT_SETTINGS.mcpHttpServicePort;
	if (n > 65535) return DEFAULT_SETTINGS.mcpHttpServicePort;
	return n;
}

export function clampDebounceMs(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.autoIndexDebounceMs);
	if (n < 250) return 250;
	if (n > 60_000) return 60_000;
	return n;
}
