// Vitest 설정
// - Node.js 환경에서 실행
// - TS(NodeNext) 패턴의 `.js` import를 테스트에서 `.ts` 소스로 매핑

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
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
