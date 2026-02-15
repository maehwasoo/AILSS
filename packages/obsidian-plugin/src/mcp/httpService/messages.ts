export function composePortInUseErrorMessage(options: {
	host: string;
	port: number;
	shutdownAttempted: boolean;
	shutdownSucceeded: boolean;
	lastErrorMessage: string | null;
}): string {
	const baseMessage = `Port ${options.port} is already in use (${options.host}). Stop the process using it, or change the port in settings.`;
	if (options.shutdownAttempted && !options.shutdownSucceeded && options.lastErrorMessage) {
		return `${options.lastErrorMessage}\n\n${baseMessage}`;
	}

	return baseMessage;
}

export function composeUnexpectedStopErrorMessage(options: {
	code: number | null;
	signal: NodeJS.Signals | null;
	liveStderr: string;
	durableLogPath: string | null;
}): string {
	const stderr = options.liveStderr.trim();
	const stderrTail = stderr ? stderr.split(/\r?\n/).slice(-10).join("\n").trim() : "";
	const suffix = options.code === null ? `signal ${options.signal}` : `exit ${options.code}`;
	const logHint = options.durableLogPath ? `\nMCP log file: ${options.durableLogPath}` : "";
	return stderrTail
		? `Unexpected stop (${suffix}). Last stderr:\n${stderrTail}${logHint}`
		: `Unexpected stop (${suffix}).${logHint}`;
}
