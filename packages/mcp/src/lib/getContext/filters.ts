export type AppliedFilters = {
  path_prefix: string | null;
  tags_any: string[];
  tags_all: string[];
};

export type SemanticFilters = {
  tagsAny: string[];
  tagsAll: string[];
  pathPrefix?: string;
};

export function normalizeFilterStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

export function buildAppliedFilters(
  pathPrefix: string | undefined,
  tagsAny: string[] | undefined,
  tagsAll: string[] | undefined,
): AppliedFilters {
  return {
    path_prefix: pathPrefix?.trim() || null,
    tags_any: normalizeFilterStrings(tagsAny),
    tags_all: normalizeFilterStrings(tagsAll),
  };
}

export function buildSemanticFilters(appliedFilters: AppliedFilters): SemanticFilters {
  return {
    tagsAny: appliedFilters.tags_any,
    tagsAll: appliedFilters.tags_all,
    ...(appliedFilters.path_prefix ? { pathPrefix: appliedFilters.path_prefix } : {}),
  };
}
