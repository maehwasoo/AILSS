// Commit message rules
// - minimal enforcement based on docs/standards/commits.md

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
