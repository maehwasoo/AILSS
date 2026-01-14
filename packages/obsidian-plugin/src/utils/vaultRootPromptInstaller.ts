import { promptFilename, promptTemplate, type PromptKind } from "./promptTemplates.js";

type VaultAdapterLike = {
	exists: (path: string) => Promise<boolean>;
	write: (path: string, data: string) => Promise<void>;
};

export type InstallVaultRootPromptResult =
	| { status: "exists"; fileName: string }
	| { status: "installed"; fileName: string };

export async function installVaultRootPromptAtVaultRoot(
	adapter: VaultAdapterLike,
	options: { kind: PromptKind; overwrite: boolean },
): Promise<InstallVaultRootPromptResult> {
	const fileName = promptFilename(options.kind);

	const exists = await adapter.exists(fileName);
	if (exists && !options.overwrite) {
		return { status: "exists", fileName };
	}

	await adapter.write(fileName, promptTemplate(options.kind));
	return { status: "installed", fileName };
}
