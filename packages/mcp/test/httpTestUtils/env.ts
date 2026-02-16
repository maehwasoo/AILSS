type EnvKey =
  | "OPENAI_API_KEY"
  | "OPENAI_EMBEDDING_MODEL"
  | "AILSS_DB_PATH"
  | "AILSS_VAULT_PATH"
  | "AILSS_ENABLE_WRITE_TOOLS"
  | "AILSS_MCP_HTTP_MAX_SESSIONS"
  | "AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE";

export type EnvOverrides = Partial<Record<EnvKey, string | undefined>>;

export async function withEnv<T>(overrides: EnvOverrides, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(overrides) as EnvKey[];
  const saved: Partial<Record<EnvKey, string | undefined>> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }

  for (const key of keys) {
    if (!(key in overrides)) continue;
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
