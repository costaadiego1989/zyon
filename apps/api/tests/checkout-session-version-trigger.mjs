import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Prisma schema diff does not reproduce custom SQL triggers. Install the
 * reviewed migration verbatim in the caller's already-owned disposable DB.
 * This is deliberately not a migration-history or production-schema claim. */
export async function installCheckoutSessionVersionTrigger(db) {
  const name = "20260929020000_checkout_session_write_version/migration.sql";
  const migration = await readFile(new URL(`../prisma/migrations/${name}`, import.meta.url), "utf8");
  const deployment = await readFile(new URL(`../prisma/deploy-migrations/${name}`, import.meta.url), "utf8");
  assert.equal(migration, deployment, "checkout_version_trigger_deploy_migration_must_match");
  await db.sql(migration);
  assert.equal(await db.sql(`SELECT count(*) FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='checkout_sessions'
      AND t.tgname='checkout_session_write_version_guard' AND NOT t.tgisinternal
      AND t.tgenabled='O'`), "1", "actual_checkout_version_trigger_required");
  // The column already comes from the canonical schema / native fixture.
  // Extract only this exact existing function+trigger, not the other strategy
  // tables/guards in the migration. This does not attest that migration history.
  const strategyName = "20260924230000_strategy_turn_completions/migration.sql";
  const strategy = await readFile(new URL(`../prisma/migrations/${strategyName}`, import.meta.url), "utf8");
  assert.equal(strategy, await readFile(new URL(`../prisma/deploy-migrations/${strategyName}`, import.meta.url), "utf8"),
    "checkout_strategy_trigger_deploy_migration_must_match");
  const selected = strategy.match(/CREATE FUNCTION guard_strategy_session_context_version\(\)[\s\S]*?EXECUTE FUNCTION guard_strategy_session_context_version\(\);/);
  assert.ok(selected, "exact_strategy_session_context_trigger_required");
  await db.sql(selected[0]);
  assert.equal(await db.sql(`SELECT count(*) FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='checkout_sessions'
      AND t.tgname='strategy_session_context_version_guard' AND NOT t.tgisinternal
      AND t.tgenabled='O'`), "1", "actual_checkout_strategy_trigger_required");
}
