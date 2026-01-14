type ClipboardLike = {
	writeText?: (value: string) => Promise<void>;
};

export async function writeTextToClipboard(text: string): Promise<void> {
	const clipboard = (navigator as unknown as { clipboard?: ClipboardLike }).clipboard;
	if (!clipboard?.writeText) {
		throw new Error("Clipboard not available.");
	}

	await clipboard.writeText(text);
}
