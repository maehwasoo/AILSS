export function removeMarkdownExtension(vaultRelPath: string): string {
  return vaultRelPath.toLowerCase().endsWith(".md") ? vaultRelPath.slice(0, -3) : vaultRelPath;
}

export function splitTargetAndDisplay(raw: string): {
  target_for_resolution: string;
  display_for_canonical_link: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      target_for_resolution: "",
      display_for_canonical_link: "",
    };
  }

  const inner =
    trimmed.startsWith("[[") && trimmed.endsWith("]]") ? trimmed.slice(2, -2).trim() : trimmed;

  const pipeIndex = inner.indexOf("|");
  const left = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
  const right = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "").trim();
  const targetForResolution = left.split("#")[0]?.trim() ?? "";
  const displayForCanonicalLink = right || left || inner;

  return {
    target_for_resolution: targetForResolution || left || inner,
    display_for_canonical_link: displayForCanonicalLink,
  };
}

export function canonicalWikilink(pathNoExt: string, display: string): string {
  return `[[${pathNoExt}|${display}]]`;
}
