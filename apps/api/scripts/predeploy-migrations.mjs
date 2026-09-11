import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const client = new pg.Client({ connectionString: databaseUrl });
const failedLegacyMigration = "20260501103000_checkout_module";
const failedPaymentHoldMigration = "20260911130000_payment_hold_payout_lifecycle";
const baselineMigration = "20260905000000_complete_schema";

function prisma(args) {
  const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Prisma command failed: ${args.join(" ")}${result.error ? ` (${result.error.message})` : ""}`);
  }
}

await client.connect();
try {
  const { rows: schemaRows } = await client.query(`
    SELECT
      to_regclass('public.merchants') IS NOT NULL AS has_merchants,
      to_regclass('public.checkout_sessions') IS NOT NULL AS has_checkout_sessions,
      to_regclass('public.merchant_rules') IS NOT NULL AS has_merchant_rules,
      to_regclass('public.storefront_carts') IS NOT NULL AS has_storefront_carts,
      to_regclass('public.payment_holds') IS NOT NULL AS has_payment_holds,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_holds'
          AND column_name = 'provider'
      ) AS has_payment_hold_provider,
      to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations,
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') AS table_count
  `);
  const schema = schemaRows[0];

  const failedRows = schema.has_migrations ? (await client.query(
    `SELECT logs, finished_at, rolled_back_at FROM "_prisma_migrations"
     WHERE migration_name = $1 ORDER BY started_at DESC LIMIT 1`, [failedLegacyMigration],
  )).rows : [];
  const failed = failedRows[0];
  if (failed && !failed.finished_at && !failed.rolled_back_at) {
    const expectedFailure = String(failed.logs ?? "").includes("42P07")
      && String(failed.logs ?? "").includes("checkout_sessions");
    if (!expectedFailure || !schema.has_checkout_sessions) {
      throw new Error("Refusing to reconcile an unexpected failed migration");
    }
    console.log("Reconciling the verified legacy checkout migration record");
    prisma(["migrate", "resolve", "--applied", failedLegacyMigration, "--config", "prisma.legacy.config.ts"]);
  }

  const failedPaymentHoldRows = schema.has_migrations ? (await client.query(
    `SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
     WHERE migration_name = $1 ORDER BY started_at DESC LIMIT 1`, [failedPaymentHoldMigration],
  )).rows : [];
  const failedPaymentHold = failedPaymentHoldRows[0];
  if (failedPaymentHold && !failedPaymentHold.finished_at && !failedPaymentHold.rolled_back_at) {
    // The first version of this migration used CREATE TABLE IF NOT EXISTS even
    // though the baseline already supplied payment_holds. The expected failed
    // state has the legacy table but no provider column; only this state can be
    // safely rolled back and replayed with the additive migration above.
    if (!schema.has_payment_holds || schema.has_payment_hold_provider) {
      throw new Error("Refusing to reconcile an unexpected failed payment-hold migration");
    }
    console.log("Rolling back the verified incomplete payment-hold migration record");
    prisma(["migrate", "resolve", "--rolled-back", failedPaymentHoldMigration]);
  }

  const baselineRows = schema.has_migrations ? (await client.query(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL LIMIT 1`,
    [baselineMigration],
  )).rows : [];
  if (schema.has_merchants && baselineRows.length === 0) {
    const compatibleExistingSchema = schema.has_checkout_sessions
      && schema.has_merchant_rules
      && schema.has_storefront_carts
      && Number(schema.table_count) >= 100;
    if (!compatibleExistingSchema) throw new Error("Existing database does not match the verified production baseline");
    console.log("Registering the verified existing schema as the production baseline");
    prisma(["migrate", "resolve", "--applied", baselineMigration]);
  }
} finally {
  await client.end();
}

prisma(["migrate", "deploy"]);

// A prior deploy can record a migration as applied even when a deployment is
// interrupted between its history update and an additive schema change. Verify
// this exact scheduled-cancellation column after Prisma finishes, so the
// generated client never starts against that known divergent state.
const verificationClient = new pg.Client({ connectionString: databaseUrl });
await verificationClient.connect();
try {
  const { rows } = await verificationClient.query(`
    SELECT
      to_regclass('public.merchant_billing_subscriptions') IS NOT NULL AS has_billing_subscriptions,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'merchant_billing_subscriptions'
          AND column_name = 'provider_cancellation_scheduled_at'
      ) AS has_provider_cancellation_scheduled_at
  `);
  const postDeploySchema = rows[0];
  if (!postDeploySchema.has_billing_subscriptions) {
    throw new Error("Expected merchant_billing_subscriptions after Prisma migrations");
  }
  if (!postDeploySchema.has_provider_cancellation_scheduled_at) {
    console.log("Repairing the scheduled billing-cancellation schema drift");
    await verificationClient.query(`
      ALTER TABLE "merchant_billing_subscriptions"
        ADD COLUMN IF NOT EXISTS "provider_cancellation_scheduled_at" TIMESTAMP(3)
    `);
  }
} finally {
  await verificationClient.end();
}
