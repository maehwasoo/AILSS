import { requestPythonApiRetrieve, runPythonApiAgent } from "./client.js";

export function formatPythonRetrieveResult(
	result: Awaited<ReturnType<typeof requestPythonApiRetrieve>>,
): string {
	const lines = [
		`Query: ${result.query}`,
		`Mode: ${result.mode}`,
		`Results: ${result.results.length}`,
		`Latency: ${Math.round(result.usage.latency_ms)} ms`,
	];

	if (result.usage.embedding_model) {
		lines.push(`Embedding model: ${result.usage.embedding_model}`);
	}
	if (typeof result.usage.embedding_prompt_tokens === "number") {
		lines.push(`Embedding prompt tokens: ${result.usage.embedding_prompt_tokens}`);
	}
	if (result.warnings.length > 0) {
		lines.push("", "Warnings:");
		for (const warning of result.warnings) {
			lines.push(`- ${warning}`);
		}
	}

	if (result.results.length === 0) {
		lines.push("", "No grounded results.");
		return lines.join("\n");
	}

	lines.push("", "Grounded matches:");
	for (const [index, entry] of result.results.entries()) {
		lines.push(`${index + 1}. ${entry.path}`);
		if (entry.title) lines.push(`   Title: ${entry.title}`);
		if (entry.summary) lines.push(`   Summary: ${entry.summary}`);
		lines.push(`   Snippet: ${entry.snippet}`);
		if (entry.evidence.length > 0) {
			const citationList = entry.evidence.map((chunk) => chunk.chunk_id).join(", ");
			lines.push(`   Evidence: ${citationList}`);
		}
	}

	return lines.join("\n");
}

export function formatPythonAgentResult(
	result: Awaited<ReturnType<typeof runPythonApiAgent>>,
): string {
	const lines = [
		`Run ID: ${result.run_id}`,
		`Outcome: ${result.outcome}`,
		`Retrieval mode: ${result.metrics.retrieval_mode}`,
		`Selected notes: ${result.metrics.selected_notes}`,
		`Latency: ${Math.round(result.metrics.latency_ms)} ms`,
	];

	if (typeof result.metrics.embedding_prompt_tokens === "number") {
		lines.push(`Embedding prompt tokens: ${result.metrics.embedding_prompt_tokens}`);
	}
	if (result.artifact_path) {
		lines.push(`Artifact: ${result.artifact_path}`);
	}
	if (result.answer) {
		lines.push("", "Answer:", result.answer);
	}
	if (result.citations.length > 0) {
		lines.push("", "Citations:");
		for (const citation of result.citations) {
			lines.push(`- ${citation.path}#${citation.chunk_id}`);
		}
	}
	if (result.failure) {
		lines.push("", "Failure:", `- ${result.failure.code}: ${result.failure.message}`);
	}
	if (result.write_actions.length > 0) {
		lines.push("", "Write actions:");
		for (const action of result.write_actions) {
			lines.push(`- ${action.action}: ${action.allowed ? "allowed" : action.reason}`);
		}
	}
	if (result.workflow.length > 0) {
		lines.push("", "Workflow:");
		for (const step of result.workflow) {
			const detailSuffix = step.detail ? ` (${step.detail})` : "";
			lines.push(`- ${step.name}: ${step.outcome}${detailSuffix}`);
		}
	}

	return lines.join("\n");
}
