import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFiscalTestDatabaseUrl, type createFiscalFixture } from "./fiscal-fixture.js";
import { fiscalFixtureDatabaseTarget } from "./fiscal-local-target.js";

export const PUBLISHED_FISCAL_BASELINE_REVISION = "5a794058f636229d84ed9d60142d8548d114010c";
export const PUBLISHED_FISCAL_BASELINE_SCHEMA_SHA256 = "5294e1663f5750c2a4b10d61ebc9ccc38ad92e25cbac3e2e9d60e6a818dda92d";
const api = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
type FiscalFixture = Awaited<ReturnType<typeof createFiscalFixture>>;

export function requirePublishedFiscalBaselineTarget(value = process.env.FISCAL_TEST_DATABASE_URL, githubActions = process.env.GITHUB_ACTIONS) {
  const target = parseFiscalTestDatabaseUrl(value);
  if (target.toString() !== fiscalFixtureDatabaseTarget(githubActions)) throw new Error("fiscal_baseline_requires_exact_local_database");
  return target;
}

/** This is a local model projection, never a copy or assertion of production history. */
export async function preparePublishedFiscalBaseline(fixture: FiscalFixture) {
  const original = requirePublishedFiscalBaselineTarget();
  const scoped = new URL(fixture.databaseUrl);
  const schemaEntries = [...scoped.searchParams.entries()];
  if (!/^fiscal_test_[a-f0-9]{32}$/.test(fixture.schema)
    || schemaEntries.length !== 1 || schemaEntries[0][0] !== "schema" || schemaEntries[0][1] !== fixture.schema) {
    throw new Error("fiscal_baseline_requires_exact_owned_local_schema");
  }
  scoped.search = "";
  if (scoped.toString() !== original.toString()
    || (await fixture.sql.query("SELECT current_schema() AS schema")).rows[0]?.schema !== fixture.schema) {
    throw new Error("fiscal_baseline_schema_scope_mismatch");
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, maxBuffer: 8 * 1024 * 1024 });
  const revision = git("rev-parse", PUBLISHED_FISCAL_BASELINE_REVISION).toString("utf8").trim();
  const schema = git("show", revision + ":apps/api/prisma/schema.prisma");
  const schemaSha256 = createHash("sha256").update(schema).digest("hex");
  if (revision !== PUBLISHED_FISCAL_BASELINE_REVISION || schemaSha256 !== PUBLISHED_FISCAL_BASELINE_SCHEMA_SHA256) {
    throw new Error("fiscal_published_baseline_identity_mismatch");
  }
  const representedMigrations = git("ls-tree", "--name-only", revision + ":apps/api/prisma/deploy-migrations")
    .toString("utf8").trim().split(/\r?\n/).sort();
  if (representedMigrations.length !== 13 || representedMigrations.some(name => !/^\d{14}_[a-z0-9_]+$/.test(name))) {
    throw new Error("fiscal_published_baseline_history_mismatch");
  }
  const scratchRoot = realpathSync(tmpdir());
  const scratch = mkdtempSync(join(scratchRoot, "zyon-fiscal-published-"));
  const schemaPath = join(scratch, "published-schema.prisma");
  try {
    writeFileSync(schemaPath, schema);
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], {
      cwd: api, env: { ...process.env, DATABASE_URL: fixture.databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 150_000,
    });
  } finally {
    // Verify the resolved absolute owned directory before deleting either exact file/path.
    const resolved = realpathSync(scratch);
    if (dirname(resolved) !== scratchRoot || !/^zyon-fiscal-published-[a-zA-Z0-9]+$/.test(basename(resolved))
      || relative(resolved, schemaPath) !== "published-schema.prisma") throw new Error("fiscal_baseline_scratch_scope_mismatch");
    unlinkSync(schemaPath);
    rmdirSync(resolved);
  }
  await fixture.sql.query('CREATE TABLE "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)');
  for (const name of representedMigrations) {
    const checksum = createHash("sha256").update(git("show", revision + ":apps/api/prisma/deploy-migrations/" + name + "/migration.sql")).digest("hex");
    await fixture.sql.query('INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,logs,applied_steps_count) VALUES ($1,$2,now(),$3,$4,0)',
      [randomUUID(), checksum, name, "LOCAL FIXTURE ONLY: represented by published model projection " + revision + "; SQL not replayed and production history not inspected"]);
  }
  return { revision, schemaSha256, representedMigrations, ownedSchema: fixture.schema, method: "synthetic published model projection; local represented history only; no production records" };
}
