import { promises as fs } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type McpToolFailureEvent = {
  timestamp: string;
  tool: string;
  operation: string;
  input_path: string | null;
  resolved_path: string | null;
  error: {
    code: string | null;
    name: string | null;
    message: string;
  };
  cwd: string;
  vault_root: string | null;
  request_id: string | number | null;
  session_id: string | null;
  correlation_id: string | null;
};

export type McpToolFailureTypeSummary = {
  tool: string;
  error_code: string | null;
  error_name: string | null;
  count: number;
  first_timestamp: string;
  last_timestamp: string;
  sample_message: string;
};

export type McpToolFailureReport = {
  enabled: boolean;
  log_dir: string | null;
  log_path: string | null;
  scanned_events: number;
  matched_events: number;
  first_timestamp: string | null;
  last_timestamp: string | null;
  top_error_types: McpToolFailureTypeSummary[];
  recent_events: McpToolFailureEvent[];
};

export type LogMcpToolFailureOptions = {
  tool: string;
  operation?: string;
  args?: unknown;
  error: unknown;
  requestId?: unknown;
  sessionId?: unknown;
};

export type GetToolFailureReportOptions = {
  recentLimit: number;
  topErrorLimit: number;
  tool?: string;
};

export type McpToolFailureDiagnostics = {
  enabled: boolean;
  logDir: string | null;
  logPath: string | null;
  logToolFailure(options: LogMcpToolFailureOptions): Promise<void>;
  getToolFailureReport(options: GetToolFailureReportOptions): Promise<McpToolFailureReport>;
};

const LOG_FILE_NAME = "mcp-tool-failures.jsonl";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toRequestId(value: unknown): string | number | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function extractPrimaryInputPath(args: unknown): string | null {
  if (!isRecord(args)) return null;

  const pathLikeKeys = ["path", "input_path", "from_path", "to_path"] as const;
  for (const key of pathLikeKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function normalizeError(error: unknown): {
  code: string | null;
  name: string | null;
  message: string;
} {
  if (error instanceof Error) {
    const rawCode = (error as NodeJS.ErrnoException).code;
    const code =
      typeof rawCode === "string" ? rawCode : typeof rawCode === "number" ? String(rawCode) : null;
    return {
      code,
      name: error.name || null,
      message: error.message || "Unknown error",
    };
  }

  if (isRecord(error)) {
    const code = toNullableString(error["code"]);
    const name = toNullableString(error["name"]);
    const message = toNullableString(error["message"]) ?? JSON.stringify(error);
    return { code, name, message };
  }

  return { code: null, name: null, message: String(error) };
}

function correlationIdFor(
  requestId: string | number | null,
  sessionId: string | null,
): string | null {
  if (requestId === null && sessionId === null) return null;
  const sid = sessionId ?? "no-session";
  const rid = requestId ?? "no-request";
  return `${sid}:${rid}`;
}

function toResolvedPath(vaultRoot: string | null, inputPath: string | null): string | null {
  if (!vaultRoot || !inputPath) return null;
  return path.resolve(vaultRoot, inputPath);
}

function parseEvent(raw: unknown): McpToolFailureEvent | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw["error"])) return null;

  const timestamp = toNullableString(raw["timestamp"]);
  const tool = toNullableString(raw["tool"]);
  const operation = toNullableString(raw["operation"]);
  const cwd = toNullableString(raw["cwd"]);
  const message = toNullableString(raw["error"]["message"]);

  if (!timestamp || !tool || !operation || !cwd || !message) return null;

  return {
    timestamp,
    tool,
    operation,
    input_path: toNullableString(raw["input_path"]),
    resolved_path: toNullableString(raw["resolved_path"]),
    error: {
      code: toNullableString(raw["error"]["code"]),
      name: toNullableString(raw["error"]["name"]),
      message,
    },
    cwd,
    vault_root: toNullableString(raw["vault_root"]),
    request_id: toRequestId(raw["request_id"]),
    session_id: toNullableString(raw["session_id"]),
    correlation_id: toNullableString(raw["correlation_id"]),
  };
}

async function readEventsFromJsonl(logPath: string | null): Promise<McpToolFailureEvent[]> {
  if (!logPath) return [];

  let text: string;
  try {
    text = await fs.readFile(logPath, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }

  const events: McpToolFailureEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const event = parseEvent(parsed);
      if (event) events.push(event);
    } catch {
      // Skip malformed rows to keep diagnostics resilient.
    }
  }

  return events;
}

function summarizeTopErrors(
  events: McpToolFailureEvent[],
  topErrorLimit: number,
): McpToolFailureTypeSummary[] {
  type Bucket = {
    tool: string;
    error_code: string | null;
    error_name: string | null;
    count: number;
    first_timestamp: string;
    last_timestamp: string;
    sample_message: string;
  };

  const buckets = new Map<string, Bucket>();

  for (const event of events) {
    const bucketKey = `${event.tool}::${event.error.code ?? ""}::${event.error.name ?? ""}`;
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, {
        tool: event.tool,
        error_code: event.error.code,
        error_name: event.error.name,
        count: 1,
        first_timestamp: event.timestamp,
        last_timestamp: event.timestamp,
        sample_message: event.error.message,
      });
      continue;
    }

    existing.count += 1;
    if (event.timestamp < existing.first_timestamp) existing.first_timestamp = event.timestamp;
    if (event.timestamp > existing.last_timestamp) {
      existing.last_timestamp = event.timestamp;
      existing.sample_message = event.error.message;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || b.last_timestamp.localeCompare(a.last_timestamp))
    .slice(0, topErrorLimit);
}

export function createMcpToolFailureDiagnostics(options: {
  vaultPath: string | undefined;
  cwd: string;
}): McpToolFailureDiagnostics {
  const vaultRoot = options.vaultPath ?? null;
  const enabled = Boolean(vaultRoot);
  const logDir = vaultRoot ? path.join(vaultRoot, ".ailss", "logs") : null;
  const logPath = logDir ? path.join(logDir, LOG_FILE_NAME) : null;

  let writeChain: Promise<void> = Promise.resolve();

  const enqueueWrite = async (line: string): Promise<void> => {
    if (!logDir || !logPath) return;

    writeChain = writeChain
      .then(async () => {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logPath, `${line}\n`, "utf8");
      })
      .catch(() => undefined);

    await writeChain;
  };

  const logToolFailure = async (logOptions: LogMcpToolFailureOptions): Promise<void> => {
    if (!enabled) return;

    const inputPath = extractPrimaryInputPath(logOptions.args);
    const requestId = toRequestId(logOptions.requestId);
    const sessionId = toNullableString(logOptions.sessionId);

    const event: McpToolFailureEvent = {
      timestamp: new Date().toISOString(),
      tool: logOptions.tool,
      operation: logOptions.operation ?? "tool_call",
      input_path: inputPath,
      resolved_path: toResolvedPath(vaultRoot, inputPath),
      error: normalizeError(logOptions.error),
      cwd: options.cwd,
      vault_root: vaultRoot,
      request_id: requestId,
      session_id: sessionId,
      correlation_id: correlationIdFor(requestId, sessionId),
    };

    try {
      await enqueueWrite(JSON.stringify(event));
    } catch {
      // Never fail a tool call because diagnostics logging failed.
    }
  };

  const getToolFailureReport = async (
    reportOptions: GetToolFailureReportOptions,
  ): Promise<McpToolFailureReport> => {
    const recentLimit = Math.max(1, Math.floor(reportOptions.recentLimit));
    const topErrorLimit = Math.max(1, Math.floor(reportOptions.topErrorLimit));
    const toolFilter = reportOptions.tool?.trim();

    const events = await readEventsFromJsonl(logPath);
    const filtered = toolFilter ? events.filter((event) => event.tool === toolFilter) : events;

    const firstTimestamp = filtered.length > 0 ? (filtered[0]?.timestamp ?? null) : null;
    const lastTimestamp =
      filtered.length > 0 ? (filtered[filtered.length - 1]?.timestamp ?? null) : null;

    return {
      enabled,
      log_dir: logDir,
      log_path: logPath,
      scanned_events: events.length,
      matched_events: filtered.length,
      first_timestamp: firstTimestamp,
      last_timestamp: lastTimestamp,
      top_error_types: summarizeTopErrors(filtered, topErrorLimit),
      recent_events: filtered.slice(-recentLimit).reverse(),
    };
  };

  return {
    enabled,
    logDir,
    logPath,
    logToolFailure,
    getToolFailureReport,
  };
}
