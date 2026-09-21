import { execFileSync } from "node:child_process";

const expectedBranch = process.argv[2];
if (!expectedBranch) {
  console.error("Usage: node scripts/verify-production-release.mjs <branch>");
  process.exit(1);
}

const currentBranch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (currentBranch !== expectedBranch) {
  console.error(`Release blocked: expected branch ${expectedBranch}, found ${currentBranch || "detached HEAD"}.`);
  process.exit(1);
}

const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirtyPaths) {
  console.error("Release blocked: commit or stash local changes before publishing.");
  process.exit(1);
}

console.log(`Release preflight passed for ${expectedBranch}.`);
