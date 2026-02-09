// Neo4j graph sync and query helpers
// - optional SQLite -> Neo4j hybrid integration

import { randomUUID } from "node:crypto";

import neo4j from "neo4j-driver";
import type { Driver, Session } from "neo4j-driver";

import {
  getSqliteGraphCounts,
  listNotesForGraphSync,
  listTypedLinksForGraphSync,
  resolveNotePathsByWikilinkTarget,
  type AilssDb,
} from "../db/db.js";
import type { AilssEnv } from "../env.js";

export type Neo4jConnectionConfig = {
  uri: string;
  username: string;
  password: string;
  database: string;
};

export type Neo4jSettings = {
  enabled: boolean;
  syncOnIndex: boolean;
  strictMode: boolean;
  config: Neo4jConnectionConfig | null;
  unavailableReason: string | null;
};

function nonEmptyOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function resolveNeo4jSettings(
  env: Pick<
    AilssEnv,
    | "neo4jEnabled"
    | "neo4jUri"
    | "neo4jUsername"
    | "neo4jPassword"
    | "neo4jDatabase"
    | "neo4jSyncOnIndex"
    | "neo4jStrictMode"
  >,
): Neo4jSettings {
  if (!env.neo4jEnabled) {
    return {
      enabled: false,
      syncOnIndex: env.neo4jSyncOnIndex,
      strictMode: env.neo4jStrictMode,
      config: null,
      unavailableReason: "Neo4j integration disabled. Set AILSS_NEO4J_ENABLED=1 to enable it.",
    };
  }

  const uri = nonEmptyOrNull(env.neo4jUri);
  const username = nonEmptyOrNull(env.neo4jUsername);
  const password = nonEmptyOrNull(env.neo4jPassword);
  const database = nonEmptyOrNull(env.neo4jDatabase) ?? "neo4j";

  if (!uri || !username || !password) {
    return {
      enabled: true,
      syncOnIndex: env.neo4jSyncOnIndex,
      strictMode: env.neo4jStrictMode,
      config: null,
      unavailableReason:
        "Neo4j enabled but not fully configured. Set AILSS_NEO4J_URI, AILSS_NEO4J_USERNAME, and AILSS_NEO4J_PASSWORD.",
    };
  }

  return {
    enabled: true,
    syncOnIndex: env.neo4jSyncOnIndex,
    strictMode: env.neo4jStrictMode,
    config: { uri, username, password, database },
    unavailableReason: null,
  };
}

function createNeo4jDriver(config: Neo4jConnectionConfig): Driver {
  return neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.username, config.password),
    // Lossless integer mode
    { disableLosslessIntegers: false },
  );
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : Number.parseInt(value.toString(), 10);
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function chunked<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function runBatchWrites<T extends Record<string, unknown>>(
  session: Session,
  query: string,
  rows: T[],
  batchSize: number,
  params: Record<string, unknown> = {},
): Promise<void> {
  if (rows.length === 0) return;
  for (const batch of chunked(rows, batchSize)) {
    await session.executeWrite((tx) => tx.run(query, { ...params, rows: batch }));
  }
}

export type Neo4jGraphCounts = {
  notes: number;
  typedLinks: number;
  targets: number;
  resolvedLinks: number;
};

export type Neo4jMirrorStatus = "empty" | "ok" | "error";

export type Neo4jMirrorState = {
  activeRunId: string | null;
  status: Neo4jMirrorStatus;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

function normalizeMirrorStatus(value: unknown): Neo4jMirrorStatus {
  if (value === "ok" || value === "error" || value === "empty") {
    return value;
  }
  return "empty";
}

async function readMirrorState(session: Session): Promise<Neo4jMirrorState> {
  const result = await session.executeRead((tx) =>
    tx.run(`
      OPTIONAL MATCH (s:AilssMirrorState { name: 'active' })
      RETURN
        s.active_run_id AS activeRunId,
        coalesce(s.status, 'empty') AS status,
        s.last_success_at AS lastSuccessAt,
        s.last_error AS lastError,
        s.last_error_at AS lastErrorAt
      LIMIT 1
    `),
  );

  const row = result.records[0];
  if (!row) {
    return {
      activeRunId: null,
      status: "empty",
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
    };
  }

  const activeRunId = row.get("activeRunId");
  const lastSuccessAt = row.get("lastSuccessAt");
  const lastError = row.get("lastError");
  const lastErrorAt = row.get("lastErrorAt");

  return {
    activeRunId: typeof activeRunId === "string" ? activeRunId : null,
    status: normalizeMirrorStatus(row.get("status")),
    lastSuccessAt: typeof lastSuccessAt === "string" ? lastSuccessAt : null,
    lastError: typeof lastError === "string" ? lastError : null,
    lastErrorAt: typeof lastErrorAt === "string" ? lastErrorAt : null,
  };
}

async function ensureMirrorSchema(session: Session): Promise<void> {
  await session.executeWrite((tx) =>
    tx.run(
      "CREATE CONSTRAINT ailss_note_run_path_unique IF NOT EXISTS FOR (n:AilssNote) REQUIRE (n.run_id, n.path) IS UNIQUE",
    ),
  );
  await session.executeWrite((tx) =>
    tx.run(
      "CREATE CONSTRAINT ailss_target_run_value_unique IF NOT EXISTS FOR (t:AilssTarget) REQUIRE (t.run_id, t.target) IS UNIQUE",
    ),
  );
  await session.executeWrite((tx) =>
    tx.run(
      "CREATE CONSTRAINT ailss_mirror_state_name_unique IF NOT EXISTS FOR (s:AilssMirrorState) REQUIRE s.name IS UNIQUE",
    ),
  );
}

async function readNeo4jGraphCountsForRun(
  session: Session,
  runId: string,
): Promise<Neo4jGraphCounts> {
  const result = await session.executeRead((tx) =>
    tx.run(
      `
        CALL {
          MATCH (n:AilssNote { run_id: $runId })
          RETURN count(n) AS notes
        }
        CALL {
          MATCH ()-[r:AILSS_TYPED_LINK { run_id: $runId }]->()
          RETURN count(r) AS typedLinks
        }
        CALL {
          MATCH (t:AilssTarget { run_id: $runId })
          RETURN count(t) AS targets
        }
        CALL {
          MATCH ()-[r:AILSS_RESOLVES_TO { run_id: $runId }]->()
          RETURN count(r) AS resolvedLinks
        }
        RETURN notes, typedLinks, targets, resolvedLinks
      `,
      { runId },
    ),
  );

  const row = result.records[0];
  if (!row) {
    return { notes: 0, typedLinks: 0, targets: 0, resolvedLinks: 0 };
  }

  return {
    notes: toNumber(row.get("notes")),
    typedLinks: toNumber(row.get("typedLinks")),
    targets: toNumber(row.get("targets")),
    resolvedLinks: toNumber(row.get("resolvedLinks")),
  };
}

export type Neo4jGraphStatus = {
  sqliteCounts: {
    notes: number;
    typedLinks: number;
  };
  neo4jCounts: Neo4jGraphCounts;
  consistent: boolean;
  activeRunId: string | null;
  mirrorStatus: Neo4jMirrorStatus;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type Neo4jSyncSummary = Neo4jGraphStatus & {
  activeRunId: string;
};

export type SyncSqliteGraphToNeo4jOptions = {
  batchSize?: number;
  maxResolutionsPerTarget?: number;
};

const UPSERT_NOTES_CYPHER = `
  UNWIND $rows AS row
  MERGE (n:AilssNote { run_id: $runId, path: row.path })
  SET
    n.note_id = row.noteId,
    n.created = row.created,
    n.title = row.title,
    n.summary = row.summary,
    n.entity = row.entity,
    n.layer = row.layer,
    n.status = row.status,
    n.updated = row.updated
`;

const UPSERT_TARGETS_CYPHER = `
  UNWIND $rows AS row
  MERGE (t:AilssTarget { run_id: $runId, target: row.target })
`;

const INSERT_TYPED_LINKS_CYPHER = `
  UNWIND $rows AS row
  MATCH (from:AilssNote { run_id: $runId, path: row.fromPath })
  MATCH (target:AilssTarget { run_id: $runId, target: row.target })
  CREATE (from)-[:AILSS_TYPED_LINK {
    run_id: $runId,
    edge_key: row.edgeKey,
    rel: row.rel,
    to_wikilink: row.toWikilink,
    position: row.position
  }]->(target)
`;

const UPSERT_RESOLVED_LINKS_CYPHER = `
  UNWIND $rows AS row
  MATCH (target:AilssTarget { run_id: $runId, target: row.target })
  MATCH (to:AilssNote { run_id: $runId, path: row.toPath })
  MERGE (target)-[r:AILSS_RESOLVES_TO { run_id: $runId, to_path: row.toPath }]->(to)
  SET r.matched_by = row.matchedBy
`;

async function markMirrorError(session: Session, message: string): Promise<void> {
  const now = new Date().toISOString();
  await session.executeWrite((tx) =>
    tx.run(
      `
        MERGE (s:AilssMirrorState { name: 'active' })
        ON CREATE SET s.status = 'empty'
        SET
          s.status = 'error',
          s.last_error = $message,
          s.last_error_at = $at
      `,
      { message, at: now },
    ),
  );
}

export async function syncSqliteGraphToNeo4j(
  db: AilssDb,
  config: Neo4jConnectionConfig,
  options: SyncSqliteGraphToNeo4jOptions = {},
): Promise<Neo4jSyncSummary> {
  const sqliteCounts = getSqliteGraphCounts(db);
  const notes = listNotesForGraphSync(db);
  const typedLinks = listTypedLinksForGraphSync(db);

  const batchSize = Math.min(Math.max(1, options.batchSize ?? 500), 2000);
  const maxResolutionsPerTarget = Math.min(Math.max(1, options.maxResolutionsPerTarget ?? 20), 200);

  const runId = randomUUID();
  const syncAt = new Date().toISOString();

  const targets = Array.from(new Set(typedLinks.map((link) => link.toTarget))).sort((a, b) =>
    a.localeCompare(b),
  );
  const targetRows = targets.map((target) => ({ target }));

  const typedLinkRows = typedLinks.map((link, index) => ({
    edgeKey: `${index}:${link.fromPath}:${link.rel}:${link.toTarget}:${link.position}`,
    fromPath: link.fromPath,
    rel: link.rel,
    target: link.toTarget,
    toWikilink: link.toWikilink,
    position: link.position,
  }));

  const resolvedRows: Array<{ target: string; toPath: string; matchedBy: string }> = [];
  for (const target of targets) {
    const matches = resolveNotePathsByWikilinkTarget(db, target, maxResolutionsPerTarget);
    for (const match of matches) {
      resolvedRows.push({
        target,
        toPath: match.path,
        matchedBy: match.matchedBy,
      });
    }
  }

  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: config.database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      await ensureMirrorSchema(session);

      await runBatchWrites(session, UPSERT_NOTES_CYPHER, notes, batchSize, { runId });
      await runBatchWrites(session, UPSERT_TARGETS_CYPHER, targetRows, batchSize, { runId });
      await runBatchWrites(session, INSERT_TYPED_LINKS_CYPHER, typedLinkRows, batchSize, { runId });
      await runBatchWrites(session, UPSERT_RESOLVED_LINKS_CYPHER, resolvedRows, batchSize, {
        runId,
      });

      const neo4jCounts = await readNeo4jGraphCountsForRun(session, runId);
      const consistent =
        sqliteCounts.notes === neo4jCounts.notes &&
        sqliteCounts.typedLinks === neo4jCounts.typedLinks;

      if (!consistent) {
        throw new Error(
          [
            "Neo4j mirror counts are inconsistent after staging sync.",
            `sqlite.notes=${sqliteCounts.notes}`,
            `sqlite.typed_links=${sqliteCounts.typedLinks}`,
            `neo4j.notes=${neo4jCounts.notes}`,
            `neo4j.typed_links=${neo4jCounts.typedLinks}`,
          ].join(" "),
        );
      }

      // Atomic active-run cutover
      await session.executeWrite((tx) =>
        tx.run(
          `
            MERGE (s:AilssMirrorState { name: 'active' })
            ON CREATE SET s.status = 'empty'
            SET
              s.active_run_id = $runId,
              s.status = 'ok',
              s.last_success_at = $at,
              s.last_error = NULL,
              s.last_error_at = NULL
          `,
          { runId, at: syncAt },
        ),
      );

      return {
        sqliteCounts,
        neo4jCounts,
        consistent: true,
        activeRunId: runId,
        mirrorStatus: "ok",
        lastSuccessAt: syncAt,
        lastError: null,
        lastErrorAt: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await markMirrorError(session, message);
      } catch {
        // Best-effort error metadata
      }
      throw error;
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

export async function readNeo4jGraphStatus(
  db: AilssDb,
  config: Neo4jConnectionConfig,
): Promise<Neo4jGraphStatus> {
  const sqliteCounts = getSqliteGraphCounts(db);
  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: config.database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const mirrorState = await readMirrorState(session);
      const neo4jCounts = mirrorState.activeRunId
        ? await readNeo4jGraphCountsForRun(session, mirrorState.activeRunId)
        : { notes: 0, typedLinks: 0, targets: 0, resolvedLinks: 0 };

      const consistent =
        sqliteCounts.notes === neo4jCounts.notes &&
        sqliteCounts.typedLinks === neo4jCounts.typedLinks;

      return {
        sqliteCounts,
        neo4jCounts,
        consistent,
        activeRunId: mirrorState.activeRunId,
        mirrorStatus: mirrorState.status,
        lastSuccessAt: mirrorState.lastSuccessAt,
        lastError: mirrorState.lastError,
        lastErrorAt: mirrorState.lastErrorAt,
      };
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

export type Neo4jTraversalDirection = "outgoing" | "incoming" | "both";

export type Neo4jTraversalNode = {
  path: string;
  hop: number;
};

export type Neo4jTraversalEdge = {
  direction: "outgoing" | "incoming";
  fromPath: string;
  toPath: string | null;
  rel: string;
  target: string;
  toWikilink: string;
};

export type Neo4jTraversalResult = {
  activeRunId: string;
  nodes: Neo4jTraversalNode[];
  edges: Neo4jTraversalEdge[];
  truncated: boolean;
};

export type TraverseNeo4jGraphOptions = {
  path: string;
  direction?: Neo4jTraversalDirection;
  maxHops?: number;
  maxNotes?: number;
  maxEdges?: number;
  maxLinksPerNote?: number;
  includeUnresolvedTargets?: boolean;
};

type RawTraversalRow = {
  fromPath: string;
  toPath: string | null;
  rel: string;
  target: string;
  toWikilink: string;
};

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function queryOutgoingRows(
  session: Session,
  runId: string,
  path: string,
  limit: number,
): Promise<RawTraversalRow[]> {
  const result = await session.executeRead((tx) =>
    tx.run(
      `
        MATCH (from:AilssNote { run_id: $runId, path: $path })
          -[edge:AILSS_TYPED_LINK { run_id: $runId }]->
          (target:AilssTarget { run_id: $runId })
        OPTIONAL MATCH (target)-[:AILSS_RESOLVES_TO { run_id: $runId }]->(to:AilssNote { run_id: $runId })
        RETURN
          from.path AS fromPath,
          to.path AS toPath,
          edge.rel AS rel,
          target.target AS target,
          edge.to_wikilink AS toWikilink,
          edge.position AS position
        ORDER BY position, rel, target, toPath
        LIMIT $limit
      `,
      { runId, path, limit: neo4j.int(limit) },
    ),
  );

  return result.records.map((row) => ({
    fromPath: toStringOrEmpty(row.get("fromPath")),
    toPath: toNullableString(row.get("toPath")),
    rel: toStringOrEmpty(row.get("rel")),
    target: toStringOrEmpty(row.get("target")),
    toWikilink: toStringOrEmpty(row.get("toWikilink")),
  }));
}

async function queryIncomingRows(
  session: Session,
  runId: string,
  path: string,
  limit: number,
): Promise<RawTraversalRow[]> {
  const result = await session.executeRead((tx) =>
    tx.run(
      `
        MATCH (target:AilssTarget { run_id: $runId })-[:AILSS_RESOLVES_TO { run_id: $runId }]->(to:AilssNote { run_id: $runId, path: $path })
        MATCH (from:AilssNote { run_id: $runId })-[edge:AILSS_TYPED_LINK { run_id: $runId }]->(target)
        RETURN
          from.path AS fromPath,
          to.path AS toPath,
          edge.rel AS rel,
          target.target AS target,
          edge.to_wikilink AS toWikilink,
          edge.position AS position
        ORDER BY fromPath, position, rel, target
        LIMIT $limit
      `,
      { runId, path, limit: neo4j.int(limit) },
    ),
  );

  return result.records.map((row) => ({
    fromPath: toStringOrEmpty(row.get("fromPath")),
    toPath: toNullableString(row.get("toPath")),
    rel: toStringOrEmpty(row.get("rel")),
    target: toStringOrEmpty(row.get("target")),
    toWikilink: toStringOrEmpty(row.get("toWikilink")),
  }));
}

export async function traverseNeo4jGraph(
  config: Neo4jConnectionConfig,
  options: TraverseNeo4jGraphOptions,
): Promise<Neo4jTraversalResult> {
  const seedPath = options.path.trim();
  if (!seedPath) {
    throw new Error("Neo4j traversal path is required.");
  }

  const direction: Neo4jTraversalDirection = options.direction ?? "both";
  const maxHops = Math.min(Math.max(1, options.maxHops ?? 2), 6);
  const maxNotes = Math.min(Math.max(1, options.maxNotes ?? 80), 400);
  const maxEdges = Math.min(Math.max(1, options.maxEdges ?? 1500), 10000);
  const maxLinksPerNote = Math.min(Math.max(1, options.maxLinksPerNote ?? 80), 500);
  const includeUnresolvedTargets = options.includeUnresolvedTargets ?? false;

  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: config.database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const mirrorState = await readMirrorState(session);
      if (!mirrorState.activeRunId) {
        throw new Error("Neo4j mirror is empty. Run the indexer with Neo4j sync enabled first.");
      }
      const activeRunId = mirrorState.activeRunId;

      const seedCheck = await session.executeRead((tx) =>
        tx.run(
          `
            MATCH (n:AilssNote { run_id: $runId, path: $path })
            RETURN n.path AS path
            LIMIT 1
          `,
          { runId: activeRunId, path: seedPath },
        ),
      );
      if (seedCheck.records.length === 0) {
        throw new Error(
          `Neo4j seed note not found for path="${seedPath}" in active run ${activeRunId}. Re-run indexer sync to refresh the graph mirror.`,
        );
      }

      const nodes: Neo4jTraversalNode[] = [];
      const edges: Neo4jTraversalEdge[] = [];
      const edgeSeen = new Set<string>();
      const visited = new Set<string>([seedPath]);
      const queue: Array<{ path: string; hop: number }> = [{ path: seedPath, hop: 0 }];

      let truncated = false;

      while (queue.length > 0 && nodes.length < maxNotes) {
        const current = queue.shift();
        if (!current) break;

        nodes.push({ path: current.path, hop: current.hop });
        if (current.hop >= maxHops) continue;

        if (direction === "outgoing" || direction === "both") {
          const rows = await queryOutgoingRows(session, activeRunId, current.path, maxLinksPerNote);
          for (const row of rows) {
            if (!row.fromPath || !row.rel || !row.target) continue;
            if (row.toPath === null && !includeUnresolvedTargets) continue;

            const edgeKey = [
              "outgoing",
              row.fromPath,
              row.toPath ?? "",
              row.rel,
              row.target,
              row.toWikilink,
            ].join("::");
            if (edgeSeen.has(edgeKey)) continue;

            if (edges.length >= maxEdges) {
              truncated = true;
              break;
            }

            edgeSeen.add(edgeKey);
            edges.push({
              direction: "outgoing",
              fromPath: row.fromPath,
              toPath: row.toPath,
              rel: row.rel,
              target: row.target,
              toWikilink: row.toWikilink,
            });

            if (!row.toPath || visited.has(row.toPath)) continue;
            if (nodes.length + queue.length >= maxNotes) {
              truncated = true;
              continue;
            }
            visited.add(row.toPath);
            queue.push({ path: row.toPath, hop: current.hop + 1 });
          }
        }

        if (truncated) break;

        if (direction === "incoming" || direction === "both") {
          const rows = await queryIncomingRows(session, activeRunId, current.path, maxLinksPerNote);
          for (const row of rows) {
            if (!row.fromPath || !row.rel || !row.target) continue;

            const edgeKey = [
              "incoming",
              row.fromPath,
              row.toPath ?? "",
              row.rel,
              row.target,
              row.toWikilink,
            ].join("::");
            if (edgeSeen.has(edgeKey)) continue;

            if (edges.length >= maxEdges) {
              truncated = true;
              break;
            }

            edgeSeen.add(edgeKey);
            edges.push({
              direction: "incoming",
              fromPath: row.fromPath,
              toPath: row.toPath,
              rel: row.rel,
              target: row.target,
              toWikilink: row.toWikilink,
            });

            if (visited.has(row.fromPath)) continue;
            if (nodes.length + queue.length >= maxNotes) {
              truncated = true;
              continue;
            }
            visited.add(row.fromPath);
            queue.push({ path: row.fromPath, hop: current.hop + 1 });
          }
        }

        if (truncated) break;
      }

      return { activeRunId, nodes, edges, truncated };
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}
