import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const includeDatabase = process.argv.includes("--database");
if (includeDatabase && (!process.env.READY_PROD_TEST_PRISMA_CLIENT || !process.env.READY_PROD_TEST_DATABASE_URL)) {
  throw new Error("--database requires READY_PROD_TEST_PRISMA_CLIENT and READY_PROD_TEST_DATABASE_URL for a disposable test database");
}
if (includeDatabase) {
  const target = new URL(process.env.READY_PROD_TEST_DATABASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.pathname !== "/ready_prod_test") {
    throw new Error("Database tests are restricted to a disposable loopback database named ready_prod_test");
  }
  // Bound per-client pools and file workers; races inside each test remain concurrent.
  if (!target.searchParams.has("connection_limit")) target.searchParams.set("connection_limit", "4");
  process.env.READY_PROD_TEST_DATABASE_URL = target.toString();
  const redisUrl = process.env.READY_PROD_TEST_REDIS_URL;
  if (!redisUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(redisUrl).hostname)) {
    throw new Error("--database also requires READY_PROD_TEST_REDIS_URL pointing to disposable loopback Redis");
  }
}
const modules = ["catalog", "checkout", "embed", "stories", "storefront", "support", "returns", "marketplace", "auth", "team", "buyer-account", "whatsapp-channel", "payment", "inventory", "revenue-manager"];
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
collect(path.join(root, "apps/api/src/shared/messaging"));
const logTest = path.join(root, "apps/api/src/shared/logger/log-redaction.spec.ts");
if (fs.existsSync(logTest)) files.push(logTest);
for (const filename of ["rate-limit.guard.spec.ts", ...(includeDatabase ? ["rate-limit.integration.spec.ts"] : [])]) {
  const fullPath = path.join(root, "apps/api/src/shared/http", filename);
  if (fs.existsSync(fullPath)) files.push(fullPath);
}
if (includeDatabase) files.push(path.join(root, "apps/api/tests/stock-reservation-migration.integration.test.mjs"));
if (includeDatabase) files.push(path.join(root, "apps/api/tests/security-stage2-migrations.integration.test.mjs"));
if (includeDatabase) {
  for (const name of ["stage3-cross-module.integration.test.mjs", "inventory-sale-migration.integration.test.mjs", "outbox-leases.integration.spec.ts", "payment-recovery.integration.spec.ts"]) {
    const filename = path.join(root, "apps/api/tests", name);
    if (fs.existsSync(filename)) files.push(filename);
  }
}
const result = spawnSync(process.execPath, [
  "--loader", pathToFileURL(path.join(root, "apps/api/tests/ready-prod-loader.mjs")).href,
  "--test", "--test-force-exit", ...(includeDatabase ? ["--test-concurrency=2"] : []), ...files.sort(),
], { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
