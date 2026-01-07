import fs from "node:fs";
import process from "node:process";

const commitMsgPath = process.argv[2];

if (!commitMsgPath) {
  console.error("Usage: node scripts/commit-msg-single-line.mjs <commit-msg-path>");
  process.exit(2);
}

const raw = fs.readFileSync(commitMsgPath, "utf8");
const lines = raw.split(/\r?\n/);

const meaningfulLines = lines
  .map((line) => line.trimEnd())
  .filter((line) => !line.trim().startsWith("#"))
  .filter((line) => line.trim() !== "");

if (meaningfulLines.length === 0) {
  console.error("Commit message must contain a single non-empty header line.");
  process.exit(1);
}

if (meaningfulLines.length !== 1) {
  const extraPreview = meaningfulLines
    .slice(1, 4)
    .map((l) => `- ${l}`)
    .join("\n");
  console.error(
    [
      "Commit message must be a single line (no body, footers, or trailers).",
      `Found ${meaningfulLines.length} non-empty lines.`,
      "",
      "Extra lines (preview):",
      extraPreview || "- <none>",
    ].join("\n"),
  );
  process.exit(1);
}
