export type AilssMcpHttpServiceStatusSnapshot = {
	enabled: boolean;
	url: string;
	running: boolean;
	startedAt: string | null;
	lastExitCode: number | null;
	lastStoppedAt: string | null;
	lastErrorMessage: string | null;
};
