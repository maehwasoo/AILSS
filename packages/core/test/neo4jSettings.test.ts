import { describe, expect, it } from "vitest";

import { resolveNeo4jSettings } from "../src/index.js";

describe("resolveNeo4jSettings", () => {
  it("returns disabled settings by default", () => {
    const settings = resolveNeo4jSettings({
      neo4jEnabled: false,
      neo4jUri: undefined,
      neo4jUsername: undefined,
      neo4jPassword: undefined,
      neo4jDatabase: "neo4j",
      neo4jSyncOnIndex: true,
      neo4jStrictMode: false,
    });

    expect(settings.enabled).toBe(false);
    expect(settings.config).toBeNull();
    expect(settings.unavailableReason).toMatch(/disabled/i);
  });

  it("returns unavailable reason when required credentials are missing", () => {
    const settings = resolveNeo4jSettings({
      neo4jEnabled: true,
      neo4jUri: "bolt://127.0.0.1:7687",
      neo4jUsername: undefined,
      neo4jPassword: undefined,
      neo4jDatabase: "neo4j",
      neo4jSyncOnIndex: true,
      neo4jStrictMode: true,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.config).toBeNull();
    expect(settings.unavailableReason).toMatch(/configured/i);
    expect(settings.strictMode).toBe(true);
  });

  it("returns normalized config when all credentials are present", () => {
    const settings = resolveNeo4jSettings({
      neo4jEnabled: true,
      neo4jUri: " bolt://127.0.0.1:7687 ",
      neo4jUsername: " neo4j ",
      neo4jPassword: " password ",
      neo4jDatabase: " neo4j ",
      neo4jSyncOnIndex: false,
      neo4jStrictMode: true,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.syncOnIndex).toBe(false);
    expect(settings.strictMode).toBe(true);
    expect(settings.unavailableReason).toBeNull();
    expect(settings.config).toEqual({
      uri: "bolt://127.0.0.1:7687",
      username: "neo4j",
      password: "password",
      database: "neo4j",
    });
  });
});
