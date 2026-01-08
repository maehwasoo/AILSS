const ISO_UTC_SECONDS_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

export function parseAilssTimestamp(value: string): Date | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const normalized = ISO_UTC_SECONDS_WITHOUT_ZONE_RE.test(trimmed) ? `${trimmed}Z` : trimmed;
	const ms = Date.parse(normalized);
	if (!Number.isFinite(ms)) return null;
	return new Date(ms);
}

export function formatDateTimeLocal(date: Date): string {
	const y = date.getFullYear();
	const m = pad2(date.getMonth() + 1);
	const d = pad2(date.getDate());
	const hh = pad2(date.getHours());
	const mm = pad2(date.getMinutes());
	const ss = pad2(date.getSeconds());
	return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export function formatAilssTimestampForUi(value: string | null): string | null {
	if (!value) return null;
	const date = parseAilssTimestamp(value);
	if (!date) return value;
	return formatDateTimeLocal(date);
}
