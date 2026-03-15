import ailssAgent from "../../../../docs/ops/codex-skills/ailss-agent/SKILL.md";
import ailssAgentCurator from "../../../../docs/ops/codex-skills/ailss-agent-curator/SKILL.md";
import ailssAgentMaintenance from "../../../../docs/ops/codex-skills/ailss-agent-maintenance/SKILL.md";
import ailssAgentOntology from "../../../../docs/ops/codex-skills/ailss-agent-ontology/SKILL.md";
import prometheusAgentShim from "../../../../docs/ops/codex-skills/prometheus-agent/SKILL.md";

export const CODEX_SKILL_IDS = [
	"ailss-agent",
	"ailss-agent-ontology",
	"ailss-agent-curator",
	"ailss-agent-maintenance",
	"ailss-prometheus-agent",
] as const;

export type CodexSkillId = (typeof CODEX_SKILL_IDS)[number];

type CodexSkillMeta = {
	id: CodexSkillId;
	label: string;
	description: string;
	isLegacyShim: boolean;
};

export const CODEX_SKILLS: CodexSkillMeta[] = [
	{
		id: "ailss-agent",
		label: "ailss-agent",
		description: "Core retrieval + safe writes",
		isLegacyShim: false,
	},
	{
		id: "ailss-agent-ontology",
		label: "ailss-agent-ontology",
		description: "Typed-link ontology decisions",
		isLegacyShim: false,
	},
	{
		id: "ailss-agent-curator",
		label: "ailss-agent-curator",
		description: "Capture and curation workflow",
		isLegacyShim: false,
	},
	{
		id: "ailss-agent-maintenance",
		label: "ailss-agent-maintenance",
		description: "Broken links and migration hygiene",
		isLegacyShim: false,
	},
	{
		id: "ailss-prometheus-agent",
		label: "ailss-prometheus-agent (legacy shim)",
		description: "One-release compatibility shim",
		isLegacyShim: true,
	},
];

const CODEX_SKILL_PROMPTS: Record<CodexSkillId, string> = {
	"ailss-agent": ailssAgent,
	"ailss-agent-ontology": ailssAgentOntology,
	"ailss-agent-curator": ailssAgentCurator,
	"ailss-agent-maintenance": ailssAgentMaintenance,
	"ailss-prometheus-agent": prometheusAgentShim,
};

function normalizePromptText(text: string): string {
	// Normalize line endings for predictable clipboard copies across OSes.
	return (text ?? "").replace(/\r\n/g, "\n").trimEnd() + "\n";
}

export function codexDefaultSkillId(): CodexSkillId {
	return "ailss-agent";
}

export function codexSkillPrompt(skillId: CodexSkillId): string {
	return normalizePromptText(CODEX_SKILL_PROMPTS[skillId]);
}

export function codexPrometheusAgentPrompt(): string {
	// Legacy compatibility helper
	return codexSkillPrompt("ailss-prometheus-agent");
}
