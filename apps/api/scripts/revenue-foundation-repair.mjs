import { readFileSync } from "node:fs";

export const revenueFoundationMigration = "20260924180000_revenue_weekly_foundation";

/** Reconcile only the verified shared-telemetry collision; preserve all data. */
export async function repairRevenueFoundationFailure(client, failed, resolveMigration) {
  if (!failed || failed.finished_at || failed.rolled_back_at) return false;
  const expectedFailure = String(failed.logs ?? "").includes("42P07")
    && /relation "(?:ai_usage_events|ai_price_versions)" already exists/.test(String(failed.logs ?? ""));
  if (!expectedFailure) throw new Error("Refusing to reconcile an unexpected failed Revenue foundation migration");

  const { rows: [schema] } = await client.query(`SELECT
    to_regclass('ai_usage_events') IS NOT NULL AS has_usage,
    to_regclass('ai_price_versions') IS NOT NULL AS has_prices`);
  if (!schema.has_usage && !schema.has_prices) {
    throw new Error("Expected shared AI telemetry before Revenue foundation repair");
  }

  // This SQL is atomic and verifies every required column, default, primary
  // key and index, including existing objects. Failure leaves history intact.
  const sql = readFileSync(new URL(`../prisma/deploy-migrations/${revenueFoundationMigration}/migration.sql`, import.meta.url), "utf8");
  try { await client.query(sql); }
  catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
  // Do not claim that a partial migration was applied. Prisma replays the now
  // idempotent migration and records its own successful application/checksum.
  await resolveMigration(["migrate", "resolve", "--rolled-back", revenueFoundationMigration]);
  return true;
}
