import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const includeDatabase = process.argv.includes("--database");
if (includeDatabase && (!process.env.READY_PROD_TEST_PRISMA_CLIENT || !process.env.READY_PROD_TEST_DATABASE_URL)) {
  throw new Error("--database requires READY_PROD_TEST_PRISMA_CLIENT and READY_PROD_TEST_DATABASE_URL for a disposable test database");
}
const modules = ["catalog", "checkout", "embed", "stories", "storefront", "support", "returns", "marketplace"];
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(filename);
    else if (entry.name.endsWith(".spec.ts") && (includeDatabase || !entry.name.includes(".integration."))) files.push(filename);
  }
}
for (const name of modules) collect(path.join(root, "apps/api/src/modules", name));
collect(path.join(root, "apps/api/src/shared/auth"));
if (includeDatabase) files.push(path.join(root, "apps/api/tests/stock-reservation-migration.integration.test.mjs"));
const result = spawnSync(process.execPath, [
  "--loader", pathToFileURL(path.join(root, "apps/api/tests/ready-prod-loader.mjs")).href,
  "--test", "--test-force-exit", ...files.sort(),
], { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
