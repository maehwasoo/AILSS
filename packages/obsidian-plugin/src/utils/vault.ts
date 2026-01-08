export function normalizeVaultRelPath(input: string): string {
	return input.split("\\").join("/").trim();
}

export function shouldIndexVaultRelPath(vaultRelPath: string): boolean {
	if (!vaultRelPath.toLowerCase().endsWith(".md")) return false;

	const dirs = vaultRelPath.split("/").slice(0, -1);
	for (const dir of dirs) {
		if (
			dir === ".git" ||
			dir === ".obsidian" ||
			dir === ".trash" ||
			dir === ".backups" ||
			dir === ".ailss" ||
			dir === "node_modules"
		) {
			return false;
		}
	}

	return true;
}
