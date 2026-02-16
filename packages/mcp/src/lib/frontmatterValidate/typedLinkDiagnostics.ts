import { AILSS_TYPED_LINK_ONTOLOGY_BY_REL } from "@ailss/core";

import type { ScannedNote, TargetLookupNote, TypedLinkDiagnostic } from "./types.js";

function normalizeEntity(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeValueForLookup(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function collectTypedLinkDiagnostics(
  notes: ScannedNote[],
  lookupNotes: TargetLookupNote[],
  mode: "warn" | "error",
): TypedLinkDiagnostic[] {
  const noteIdIndex = new Map<string, TargetLookupNote[]>();
  const titleIndex = new Map<string, TargetLookupNote[]>();

  const parseableNotes = notes.filter((note) => note.parsed_frontmatter);
  const parseableLookupNotes = lookupNotes.filter((note) => note.parsed_frontmatter);

  for (const note of parseableLookupNotes) {
    const noteId = normalizeValueForLookup(note.note_id);
    if (noteId) {
      const existing = noteIdIndex.get(noteId) ?? [];
      existing.push(note);
      noteIdIndex.set(noteId, existing);
    }

    const title = normalizeValueForLookup(note.title);
    if (title) {
      const existing = titleIndex.get(title) ?? [];
      existing.push(note);
      titleIndex.set(title, existing);
    }
  }

  const resolveTargetEntity = (
    target: string,
  ): { status: "unresolved" | "ambiguous" | "resolved"; entity: string | null } => {
    const trimmed = target.trim();
    if (!trimmed) return { status: "unresolved", entity: null };

    const targetNoExt = trimmed.toLowerCase().endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
    const targetWithExt = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;

    const matches: TargetLookupNote[] = [];
    const seenPaths = new Set<string>();
    const addMatch = (candidate: TargetLookupNote): void => {
      if (seenPaths.has(candidate.path)) return;
      seenPaths.add(candidate.path);
      matches.push(candidate);
    };

    for (const note of parseableLookupNotes) {
      if (note.path === targetWithExt || note.path.endsWith(`/${targetWithExt}`)) addMatch(note);
    }

    for (const note of noteIdIndex.get(targetNoExt) ?? []) addMatch(note);
    for (const note of titleIndex.get(targetNoExt) ?? []) addMatch(note);

    if (matches.length === 0) return { status: "unresolved", entity: null };
    if (matches.length >= 2) return { status: "ambiguous", entity: null };
    return { status: "resolved", entity: normalizeEntity(matches[0]?.entity ?? null) };
  };

  const severity: "warn" | "error" = mode === "error" ? "error" : "warn";
  const diagnostics: TypedLinkDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const pushDiagnostic = (diag: TypedLinkDiagnostic): void => {
    const key = `${diag.path}\u0000${diag.rel}\u0000${diag.target ?? ""}\u0000${diag.reason}`;
    if (seenDiagnostics.has(key)) return;
    seenDiagnostics.add(key);
    diagnostics.push(diag);
  };

  for (const note of parseableNotes) {
    if (note.typed_links.length === 0) continue;

    const sourceEntity = normalizeEntity(note.entity);
    const targetsByRel = new Map<string, Set<string>>();

    for (const link of note.typed_links) {
      const rel = link.rel.trim();
      if (!rel) continue;
      const target = link.to_target.trim();
      const targets = targetsByRel.get(rel) ?? new Set<string>();
      if (target) targets.add(target);
      targetsByRel.set(rel, targets);
    }

    for (const [rel, targets] of targetsByRel) {
      const ontology =
        AILSS_TYPED_LINK_ONTOLOGY_BY_REL[rel as keyof typeof AILSS_TYPED_LINK_ONTOLOGY_BY_REL];
      const constraints = ontology && "constraints" in ontology ? ontology.constraints : undefined;
      if (!constraints) continue;

      if (typeof constraints.maxTargets === "number" && targets.size > constraints.maxTargets) {
        pushDiagnostic({
          path: note.path,
          rel,
          target: null,
          reason: `cardinality exceeded: ${targets.size} targets (max ${constraints.maxTargets})`,
          fix_hint: `Keep at most ${constraints.maxTargets} target(s) for \`${rel}\`.`,
          severity,
        });
      }

      if (constraints.sourceEntities?.length && sourceEntity) {
        const allowedSourceEntities = constraints.sourceEntities.map((entity: string) =>
          entity.toLowerCase(),
        );
        if (!allowedSourceEntities.includes(sourceEntity)) {
          pushDiagnostic({
            path: note.path,
            rel,
            target: null,
            reason: `source entity "${sourceEntity}" is incompatible with relation "${rel}"`,
            fix_hint: `Use one of: ${constraints.sourceEntities.join(", ")}, or move this link to a compatible note.`,
            severity,
          });
        }
      }

      if (constraints.conflictsWith?.length) {
        for (const conflictRel of constraints.conflictsWith) {
          const conflictTargets = targetsByRel.get(conflictRel) ?? new Set<string>();
          for (const target of targets) {
            if (!conflictTargets.has(target)) continue;
            pushDiagnostic({
              path: note.path,
              rel,
              target,
              reason: `conflict: same target appears in both "${rel}" and "${conflictRel}"`,
              fix_hint: `Keep "${target}" in only one of the two relations.`,
              severity,
            });
          }
        }
      }
    }

    for (const link of note.typed_links) {
      const rel = link.rel.trim();
      if (!rel) continue;

      const target = link.to_target.trim();
      if (!target) continue;

      const ontology =
        AILSS_TYPED_LINK_ONTOLOGY_BY_REL[rel as keyof typeof AILSS_TYPED_LINK_ONTOLOGY_BY_REL];
      const constraints = ontology && "constraints" in ontology ? ontology.constraints : undefined;
      if (!constraints?.targetEntities || constraints.targetEntities.length === 0) continue;

      const resolved = resolveTargetEntity(target);
      if (resolved.status !== "resolved") continue;

      const targetEntity = normalizeEntity(resolved.entity);
      if (!targetEntity) continue;

      const allowedTargetEntities = constraints.targetEntities.map((entity: string) =>
        entity.toLowerCase(),
      );
      if (allowedTargetEntities.includes(targetEntity)) continue;

      pushDiagnostic({
        path: note.path,
        rel,
        target,
        reason: `target entity "${targetEntity}" is incompatible with relation "${rel}"`,
        fix_hint: `Point \`${rel}\` to one of: ${constraints.targetEntities.join(", ")}.`,
        severity,
      });
    }
  }

  return diagnostics;
}
