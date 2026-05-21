import { spawnSync } from "node:child_process";

const result = spawnSync("docker", ["version"], {
  encoding: "utf8",
  shell: process.platform === "win32"
});

if (result.status === 0) {
  process.exit(0);
}

const details = [result.stderr, result.stdout, result.error?.message]
  .filter(Boolean)
  .join("\n")
  .trim();

console.error("Docker engine is not reachable. Start Docker Desktop or run this command with the required permissions.");
if (details) console.error(details);
process.exit(result.status ?? 1);
