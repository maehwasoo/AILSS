import type { AilssMcpRuntime } from "../../src/createAilssMcpServer.js";
import { createAilssMcpRuntimeFromEnv } from "../../src/createAilssMcpServer.js";
import { startAilssMcpHttpServer } from "../../src/httpServer.js";

import { withEnv } from "./env.js";
import type { EnvOverrides } from "./env.js";

export type McpHttpServerTestOptions = {
  dbPath?: string;
  vaultPath?: string;
  enableWriteTools?: boolean;
  enableJsonResponseEnv?: string;
  token?: string;
  shutdownToken?: string;
  maxSessions?: number;
  idleTtlMs?: number;
  beforeStart?: (runtime: AilssMcpRuntime) => void | Promise<void>;
};

function envForMcpRuntime(
  options: Pick<
    McpHttpServerTestOptions,
    "dbPath" | "vaultPath" | "enableWriteTools" | "enableJsonResponseEnv"
  >,
) {
  if (options.dbPath && options.vaultPath) {
    throw new Error("Test misconfiguration: provide only one of dbPath or vaultPath");
  }
  if (!options.dbPath && !options.vaultPath) {
    throw new Error("Test misconfiguration: provide dbPath or vaultPath");
  }

  // NOTE: `loadEnv()` loads `.env` without overriding already-set variables.
  // To ensure tests don't accidentally pick up user-local settings, set empty
  // strings (not deletes) for "unset" values.
  const overrides: EnvOverrides = {
    OPENAI_API_KEY: "test",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-large",
    AILSS_DB_PATH: "",
    AILSS_VAULT_PATH: "",
    AILSS_ENABLE_WRITE_TOOLS: "",
    AILSS_MCP_HTTP_ENABLE_JSON_RESPONSE: options.enableJsonResponseEnv ?? "1",
  };

  if (options.dbPath) {
    overrides.AILSS_DB_PATH = options.dbPath;
    overrides.AILSS_VAULT_PATH = "";
  }

  if (options.vaultPath) {
    overrides.AILSS_DB_PATH = "";
    overrides.AILSS_VAULT_PATH = options.vaultPath;
  }

  overrides.AILSS_ENABLE_WRITE_TOOLS = options.enableWriteTools ? "1" : "";

  return overrides;
}

export async function withMcpHttpServer<T>(
  options: McpHttpServerTestOptions,
  fn: (ctx: {
    url: string;
    token: string;
    shutdownToken: string | null;
    runtime: AilssMcpRuntime;
  }) => Promise<T>,
): Promise<T> {
  const token = options.token ?? "test-token";
  const shutdownToken = options.shutdownToken ?? null;
  const maxSessions = options.maxSessions ?? 5;
  const idleTtlMs = options.idleTtlMs ?? 60_000;

  return await withEnv(envForMcpRuntime(options), async () => {
    const runtime = await createAilssMcpRuntimeFromEnv();
    await options.beforeStart?.(runtime);

    const { close, url } = await startAilssMcpHttpServer({
      runtime,
      config: { host: "127.0.0.1", port: 0, path: "/mcp", token },
      maxSessions,
      idleTtlMs,
      ...(shutdownToken ? { shutdown: { token: shutdownToken } } : {}),
    });

    try {
      return await fn({ url, token, shutdownToken, runtime });
    } finally {
      await close();
      runtime.deps.db.close();
    }
  });
}
