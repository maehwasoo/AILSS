// Neo4j graph sync and query helpers
// - optional SQLite -> Neo4j hybrid integration

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
): Promise<void> {
  if (rows.length === 0) return;
  for (const batch of chunked(rows, batchSize)) {
    await session.executeWrite((tx) => tx.run(query, { rows: batch }));
  }
}

export type Neo4jGraphCounts = {
  notes: number;
  typedLinks: number;
  targets: number;
  resolvedLinks: number;
};

async function readNeo4jGraphCounts(session: Session): Promise<Neo4jGraphCounts> {
  const result = await session.executeRead((tx) =>
    tx.run(`
      CALL {
        MATCH (n:AilssNote)
        RETURN count(n) AS notes
      }
      CALL {
        MATCH ()-[r:AILSS_TYPED_LINK]->()
        RETURN count(r) AS typedLinks
      }
      CALL {
        MATCH (t:AilssTarget)
        RETURN count(t) AS targets
      }
      CALL {
        MATCH ()-[r:AILSS_RESOLVES_TO]->()
        RETURN count(r) AS resolvedLinks
      }
      RETURN notes, typedLinks, targets, resolvedLinks
    `),
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

export type Neo4jSyncSummary = {
  sqliteCounts: {
    notes: number;
    typedLinks: number;
  };
  neo4jCounts: Neo4jGraphCounts;
  consistent: boolean;
};

export type SyncSqliteGraphToNeo4jOptions = {
  batchSize?: number;
  maxResolutionsPerTarget?: number;
};

const UPSERT_NOTES_CYPHER = `
  UNWIND $rows AS row
  MERGE (n:AilssNote { path: row.path })
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
  MERGE (t:AilssTarget { target: row.target })
`;

const INSERT_TYPED_LINKS_CYPHER = `
  UNWIND $rows AS row
  MATCH (from:AilssNote { path: row.fromPath })
  MATCH (target:AilssTarget { target: row.target })
  CREATE (from)-[:AILSS_TYPED_LINK {
    edge_key: row.edgeKey,
    rel: row.rel,
    to_wikilink: row.toWikilink,
    position: row.position
  }]->(target)
`;

const UPSERT_RESOLVED_LINKS_CYPHER = `
  UNWIND $rows AS row
  MATCH (target:AilssTarget { target: row.target })
  MATCH (to:AilssNote { path: row.toPath })
  MERGE (target)-[r:AILSS_RESOLVES_TO { to_path: row.toPath }]->(to)
  SET r.matched_by = row.matchedBy
`;

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
      await session.executeWrite((tx) =>
        tx.run(
          "CREATE CONSTRAINT ailss_note_path_unique IF NOT EXISTS FOR (n:AilssNote) REQUIRE n.path IS UNIQUE",
        ),
      );
      await session.executeWrite((tx) =>
        tx.run(
          "CREATE CONSTRAINT ailss_target_value_unique IF NOT EXISTS FOR (t:AilssTarget) REQUIRE t.target IS UNIQUE",
        ),
      );

      // Full mirror refresh
      await session.executeWrite((tx) => tx.run("MATCH (n:AilssNote) DETACH DELETE n"));
      await session.executeWrite((tx) => tx.run("MATCH (t:AilssTarget) DETACH DELETE t"));

      await runBatchWrites(session, UPSERT_NOTES_CYPHER, notes, batchSize);
      await runBatchWrites(session, UPSERT_TARGETS_CYPHER, targetRows, batchSize);
      await runBatchWrites(session, INSERT_TYPED_LINKS_CYPHER, typedLinkRows, batchSize);
      await runBatchWrites(session, UPSERT_RESOLVED_LINKS_CYPHER, resolvedRows, batchSize);

      const neo4jCounts = await readNeo4jGraphCounts(session);
      const consistent =
        sqliteCounts.notes === neo4jCounts.notes &&
        sqliteCounts.typedLinks === neo4jCounts.typedLinks;

      return { sqliteCounts, neo4jCounts, consistent };
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
): Promise<Neo4jSyncSummary> {
  const sqliteCounts = getSqliteGraphCounts(db);
  const driver = createNeo4jDriver(config);
  try {
    await driver.verifyConnectivity();
    const session = driver.session({
      database: config.database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      const neo4jCounts = await readNeo4jGraphCounts(session);
      const consistent =
        sqliteCounts.notes === neo4jCounts.notes &&
        sqliteCounts.typedLinks === neo4jCounts.typedLinks;
      return { sqliteCounts, neo4jCounts, consistent };
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
  path: string,
  limit: number,
): Promise<RawTraversalRow[]> {
  const result = await session.executeRead((tx) =>
    tx.run(
      `
        MATCH (from:AilssNote { path: $path })-[edge:AILSS_TYPED_LINK]->(target:AilssTarget)
        OPTIONAL MATCH (target)-[:AILSS_RESOLVES_TO]->(to:AilssNote)
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
      { path, limit: neo4j.int(limit) },
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
  path: string,
  limit: number,
): Promise<RawTraversalRow[]> {
  const result = await session.executeRead((tx) =>
    tx.run(
      `
        MATCH (target:AilssTarget)-[:AILSS_RESOLVES_TO]->(to:AilssNote { path: $path })
        MATCH (from:AilssNote)-[edge:AILSS_TYPED_LINK]->(target)
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
      { path, limit: neo4j.int(limit) },
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
      const seedCheck = await session.executeRead((tx) =>
        tx.run(
          `
            MATCH (n:AilssNote { path: $path })
            RETURN n.path AS path
            LIMIT 1
          `,
          { path: seedPath },
        ),
      );
      if (seedCheck.records.length === 0) {
        throw new Error(
          `Neo4j seed note not found for path="${seedPath}". Re-run indexer sync to refresh the graph mirror.`,
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
          const rows = await queryOutgoingRows(session, current.path, maxLinksPerNote);
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
          const rows = await queryIncomingRows(session, current.path, maxLinksPerNote);
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

      return { nodes, edges, truncated };
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}
