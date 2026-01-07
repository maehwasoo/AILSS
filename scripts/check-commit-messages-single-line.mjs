import { execFileSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/check-commit-messages-single-line.mjs --from <sha> --to <sha>",
      "",
      "Checks that each non-merge commit in <from>..<to> has a single-line message.",
    ].join("\n"),
  );
}

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

const from = readArg("--from");
const to = readArg("--to");

if (!from || !to) {
  usage();
  process.exit(2);
}

const range = `${from}..${to}`;

const revList = execFileSync("git", ["rev-list", "--no-merges", range], {
  encoding: "utf8",
}).trim();

const commits = revList ? revList.split("\n").filter(Boolean) : [];

const violations = [];

for (const sha of commits) {
  const message = execFileSync("git", ["show", "-s", "--format=%B", sha], { encoding: "utf8" });
  const meaningfulLines = message
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  if (meaningfulLines.length !== 1) {
    violations.push({ sha, lineCount: meaningfulLines.length, header: meaningfulLines[0] ?? "" });
  }
}

if (violations.length > 0) {
  console.error("Commit message must be single-line only (no bodies/footers).");
  console.error(`Found ${violations.length} violating commit(s) in range ${range}:`);
  for (const { sha, lineCount, header } of violations.slice(0, 20)) {
    console.error(`- ${sha.slice(0, 7)} (${lineCount} lines): ${header}`);
  }
  if (violations.length > 20) {
    console.error(`- ... and ${violations.length - 20} more`);
  }
  process.exit(1);
}
