import type { AilssObsidianSettings } from "../settings.js";
import { clampDebounceMs } from "../utils/clamp.js";
import { normalizeVaultRelPath, shouldIndexVaultRelPath } from "../utils/vault.js";

export type AutoIndexSchedulerDeps = {
	getSettings: () => AilssObsidianSettings;
	isIndexerRunning: () => boolean;
	runIndexer: (paths: string[]) => Promise<void>;
	onError: (message: string) => void;
};

export class AutoIndexScheduler {
	private timer: NodeJS.Timeout | null = null;
	private pendingPaths = new Set<string>();
	private needsRerun = false;

	constructor(private readonly deps: AutoIndexSchedulerDeps) {}

	dispose(): void {
		this.clearSchedule();
	}

	reset(): void {
		this.clearSchedule();
		this.pendingPaths.clear();
		this.needsRerun = false;
	}

	enqueue(vaultRelPath: string): void {
		const settings = this.deps.getSettings();
		if (!settings.autoIndexEnabled) return;

		const normalized = normalizeVaultRelPath(vaultRelPath);
		if (!shouldIndexVaultRelPath(normalized)) return;

		this.pendingPaths.add(normalized);
		this.schedule();
	}

	private schedule(): void {
		this.clearSchedule();

		const settings = this.deps.getSettings();
		const ms = clampDebounceMs(settings.autoIndexDebounceMs);
		this.timer = setTimeout(() => void this.flush(), ms);
	}

	private clearSchedule(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = null;
	}

	private async flush(): Promise<void> {
		this.clearSchedule();

		const settings = this.deps.getSettings();
		if (!settings.autoIndexEnabled) {
			this.pendingPaths.clear();
			this.needsRerun = false;
			return;
		}

		const paths = Array.from(this.pendingPaths);
		this.pendingPaths.clear();
		if (paths.length === 0) return;

		if (this.deps.isIndexerRunning()) {
			for (const p of paths) this.pendingPaths.add(p);
			this.needsRerun = true;
			return;
		}

		try {
			await this.deps.runIndexer(paths);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.deps.onError(message);
		} finally {
			if (this.needsRerun) {
				this.needsRerun = false;
				this.schedule();
			}
		}
	}
}
