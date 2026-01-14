import { Notice } from "obsidian";

export function showNotice(message: string): void {
	new Notice(message);
}

export function showErrorNotice(prefix: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	new Notice(`${prefix}: ${message}`);
}
