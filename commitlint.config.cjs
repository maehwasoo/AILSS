// 커밋 메시지(commit message) 규칙
// - docs/standards/commits.md 기준으로 최소한만 강제

module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "refactor", "test", "chore", "build", "ci", "perf", "revert"],
    ],
    "scope-enum": [2, "always", ["monorepo", "core", "indexer", "mcp", "plugin", "docs", "ops"]],
    "scope-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
  },
};
