export function parseArgs(value: string): string[] {
	return value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export function parseFiniteNumber(
	value: string,
	fallback: number,
	options?: { integer?: boolean },
): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return options?.integer ? Math.floor(parsed) : parsed;
}
