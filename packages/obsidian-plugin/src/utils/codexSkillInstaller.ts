import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeTextToClipboard } from "./clipboard.js";
import { codexSkillPrompt, type CodexSkillId } from "./codexPrompts.js";

export type InstallCodexSkillResult =
	| {
			status: "exists";
			skillId: CodexSkillId;
			targetPath: string;
	  }
	| {
			status: "installed";
			skillId: CodexSkillId;
			targetPath: string;
			backupPath: string | null;
	  }
	| {
			status: "fallback_copied";
			skillId: CodexSkillId;
			targetPath: string;
			reason: string;
	  };

export function defaultCodexSkillsRootDir(): string {
	return path.join(os.homedir(), ".codex", "skills");
}

export function resolveCodexSkillsRootDir(maybePath: string): string {
	const raw = maybePath.trim();
	if (!raw) return defaultCodexSkillsRootDir();
	if (raw === "~") return os.homedir();
	if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
	return path.resolve(raw);
}

function formatBackupTimestamp(now: Date): string {
	const y = String(now.getFullYear());
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `${y}${m}${d}${hh}${mm}${ss}`;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function installCodexSkill(options: {
	skillId: CodexSkillId;
	installRootDir: string;
	overwrite: boolean;
	backup: boolean;
}): Promise<InstallCodexSkillResult> {
	const resolvedRoot = resolveCodexSkillsRootDir(options.installRootDir);
	const skillDir = path.join(resolvedRoot, options.skillId);
	const targetPath = path.join(skillDir, "SKILL.md");
	const content = codexSkillPrompt(options.skillId);

	try {
		await fs.mkdir(skillDir, { recursive: true });

		const exists = await fileExists(targetPath);
		if (exists && !options.overwrite) {
			return { status: "exists", skillId: options.skillId, targetPath };
		}

		let backupPath: string | null = null;
		if (exists && options.overwrite && options.backup) {
			const timestamp = formatBackupTimestamp(new Date());
			backupPath = `${targetPath}.bak.${timestamp}`;
			await fs.copyFile(targetPath, backupPath);
		}

		await fs.writeFile(targetPath, content, "utf8");
		return {
			status: "installed",
			skillId: options.skillId,
			targetPath,
			backupPath,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		try {
			await writeTextToClipboard(content);
			return {
				status: "fallback_copied",
				skillId: options.skillId,
				targetPath,
				reason,
			};
		} catch (clipboardError) {
			const clipboardMessage =
				clipboardError instanceof Error ? clipboardError.message : String(clipboardError);
			throw new Error(
				`Skill install failed (${reason}). Clipboard fallback failed (${clipboardMessage}).`,
			);
		}
	}
}
