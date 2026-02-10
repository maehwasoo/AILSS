// Vitest config
// - run in a Node.js environment
// - map `.js` imports (TS NodeNext pattern) to `.ts` sources in tests

import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

function resolveTsFromJsImport() {
  return {
    name: "ailss-resolve-ts-from-js-import",
    enforce: "pre",
    resolveId(source: string, importer?: string) {
      if (!importer) return null;
      if (!source.startsWith(".") && !source.startsWith("/")) return null;
      if (!source.endsWith(".js")) return null;

      const resolvedJs = path.resolve(path.dirname(importer), source);
      if (fs.existsSync(resolvedJs)) return null;

      const resolvedTs = resolvedJs.slice(0, -3) + ".ts";
      if (fs.existsSync(resolvedTs)) return resolvedTs;

      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveTsFromJsImport()],
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "packages/obsidian-plugin/test/mocks/obsidian.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
