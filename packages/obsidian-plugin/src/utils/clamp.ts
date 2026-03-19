import { DEFAULT_SETTINGS } from "../settings.js";

function clampTopKWithMax(input: number, max: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.topK);
	if (n < 1) return 1;
	if (n > max) return max;
	return n;
}

export function clampTopK(input: number): number {
	return clampTopKWithMax(input, 20);
}

export function clampPythonApiDefaultTopK(input: number): number {
	return clampTopKWithMax(input, 20);
}

export function clampPythonApiAgentTopK(input: number): number {
	return clampTopKWithMax(input, 10);
}

export function clampPort(input: number, fallback = DEFAULT_SETTINGS.mcpHttpServicePort): number {
	const n = Math.floor(Number.isFinite(input) ? input : fallback);
	if (n < 1) return fallback;
	if (n > 65535) return fallback;
	return n;
}

export function clampPythonApiPort(input: number): number {
	return clampPort(input, DEFAULT_SETTINGS.pythonApiServicePort);
}

export function clampDebounceMs(input: number): number {
	const n = Math.floor(Number.isFinite(input) ? input : DEFAULT_SETTINGS.autoIndexDebounceMs);
	if (n < 250) return 250;
	if (n > 60_000) return 60_000;
	return n;
}
