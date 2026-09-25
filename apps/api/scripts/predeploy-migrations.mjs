import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const client = new pg.Client({ connectionString: databaseUrl });
const failedLegacyMigration = "20260501103000_checkout_module";
const failedPaymentHoldMigration = "20260911130000_payment_hold_payout_lifecycle";
const failedDurableErpSyncMigration = "20260913150000_erp_durable_sync";
const failedMultiStoreMigration = "20260925013000_merchant_billing_account_multistore";
const baselineMigration = "20260905000000_complete_schema";

function prisma(args) {
  const cli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Prisma command failed: ${args.join(" ")}${result.error ? ` (${result.error.message})` : ""}`);
  }
}

async function repairDurableErpSyncSchema(client) {
  await client.query(`
    ALTER TABLE "erp_connections"
      ALTER COLUMN "direction_mode" SET DEFAULT 'bidirectional';

    UPDATE "erp_connections"
      SET "direction_mode" = 'bidirectional'
      WHERE "direction_mode" = 'erp_source_of_truth';

    CREATE TABLE IF NOT EXISTS "erp_sync_jobs" (
      "id" TEXT NOT NULL,
      "merchant_id" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'queued',
      "dedupe_key" TEXT NOT NULL,
      "payload" JSONB,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "next_attempt_at" TIMESTAMP(3),
      "locked_until" TIMESTAMP(3),
      "last_error_code" TEXT,
      "started_at" TIMESTAMP(3),
      "completed_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "erp_sync_jobs_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "erp_sync_jobs_dedupe_key_key" ON "erp_sync_jobs"("dedupe_key");
    CREATE INDEX IF NOT EXISTS "erp_sync_jobs_status_next_attempt_at_created_at_idx" ON "erp_sync_jobs"("status", "next_attempt_at", "created_at");
    CREATE INDEX IF NOT EXISTS "erp_sync_jobs_status_locked_until_idx" ON "erp_sync_jobs"("status", "locked_until");
    CREATE INDEX IF NOT EXISTS "erp_sync_jobs_merchant_id_connection_id_created_at_idx" ON "erp_sync_jobs"("merchant_id", "connection_id", "created_at");

    CREATE TABLE IF NOT EXISTS "erp_product_mappings" (
      "id" TEXT NOT NULL,
      "merchant_id" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "variant_id" TEXT,
      "sku" TEXT NOT NULL,
      "external_product_id" TEXT NOT NULL,
      "external_location_id" TEXT NOT NULL DEFAULT '0',
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "erp_product_mappings_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "erp_product_mappings_connection_id_external_product_id_external_location_id_key"
      ON "erp_product_mappings"("connection_id", "external_product_id", "external_location_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "erp_product_mappings_connection_id_sku_external_location_id_key"
      ON "erp_product_mappings"("connection_id", "sku", "external_location_id");
    CREATE INDEX IF NOT EXISTS "erp_product_mappings_merchant_id_sku_idx" ON "erp_product_mappings"("merchant_id", "sku");

    CREATE TABLE IF NOT EXISTS "erp_webhook_routes" (
      "id" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "external_account_id" TEXT NOT NULL,
      "merchant_id" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "erp_webhook_routes_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "erp_webhook_routes_provider_external_account_id_key"
      ON "erp_webhook_routes"("provider", "external_account_id");
    CREATE UNIQUE INDEX IF NOT EXISTS "erp_webhook_routes_connection_id_key"
      ON "erp_webhook_routes"("connection_id");
    CREATE INDEX IF NOT EXISTS "erp_webhook_routes_merchant_id_idx"
      ON "erp_webhook_routes"("merchant_id");

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_sync_jobs_connection_id_fkey') THEN
        ALTER TABLE "erp_sync_jobs" ADD CONSTRAINT "erp_sync_jobs_connection_id_fkey"
          FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_product_mappings_connection_id_fkey') THEN
        ALTER TABLE "erp_product_mappings" ADD CONSTRAINT "erp_product_mappings_connection_id_fkey"
          FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_webhook_routes_connection_id_fkey') THEN
        ALTER TABLE "erp_webhook_routes" ADD CONSTRAINT "erp_webhook_routes_connection_id_fkey"
          FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}

await client.connect();
try {
  const { rows: schemaRows } = await client.query(`
    SELECT
      to_regclass('public.merchants') IS NOT NULL AS has_merchants,
      to_regclass('public.checkout_sessions') IS NOT NULL AS has_checkout_sessions,
      to_regclass('public.merchant_rules') IS NOT NULL AS has_merchant_rules,
      to_regclass('public.storefront_carts') IS NOT NULL AS has_storefront_carts,
      to_regclass('public.merchant_team_members') IS NOT NULL AS has_merchant_team_members,
      to_regclass('public.payment_holds') IS NOT NULL AS has_payment_holds,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payment_holds'
          AND column_name = 'provider'
      ) AS has_payment_hold_provider,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'merchants'
          AND column_name = 'billing_account_merchant_id'
      ) AS has_billing_account_merchant_id,
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

  const failedDurableErpSyncRows = schema.has_migrations ? (await client.query(
    `SELECT logs, finished_at, rolled_back_at FROM "_prisma_migrations"
     WHERE migration_name = $1 ORDER BY started_at DESC LIMIT 1`, [failedDurableErpSyncMigration],
  )).rows : [];
  const failedDurableErpSync = failedDurableErpSyncRows[0];
  if (failedDurableErpSync && !failedDurableErpSync.finished_at && !failedDurableErpSync.rolled_back_at) {
    const expectedFailure = String(failedDurableErpSync.logs ?? "").includes("42P07")
      && String(failedDurableErpSync.logs ?? "").includes("erp_sync_jobs");
    const { rows: dependencyRows } = await client.query(`
      SELECT
        to_regclass('public.erp_connections') IS NOT NULL AS has_erp_connections,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'erp_connections'
            AND column_name = 'direction_mode'
        ) AS has_direction_mode
    `);
    if (!expectedFailure || !dependencyRows[0].has_erp_connections || !dependencyRows[0].has_direction_mode) {
      throw new Error("Refusing to reconcile an unexpected failed durable ERP migration");
    }
    console.log("Reconciling the verified durable ERP migration record");
    await repairDurableErpSyncSchema(client);
    prisma(["migrate", "resolve", "--applied", failedDurableErpSyncMigration]);
  }

  const failedMultiStoreRows = schema.has_migrations ? (await client.query(
    `SELECT logs, finished_at, rolled_back_at FROM "_prisma_migrations"
     WHERE migration_name = $1 ORDER BY started_at DESC LIMIT 1`, [failedMultiStoreMigration],
  )).rows : [];
  const failedMultiStore = failedMultiStoreRows[0];
  if (failedMultiStore && !failedMultiStore.finished_at && !failedMultiStore.rolled_back_at) {
    const expectedFailure = String(failedMultiStore.logs ?? "").includes("42701")
      && String(failedMultiStore.logs ?? "").includes("billing_account_merchant_id");
    if (!expectedFailure || !schema.has_merchants || !schema.has_merchant_team_members || !schema.has_billing_account_merchant_id) {
      throw new Error("Refusing to reconcile an unexpected failed multistore migration");
    }
    console.log("Rolling back the verified idempotent multistore migration record");
    prisma(["migrate", "resolve", "--rolled-back", failedMultiStoreMigration]);
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
      ) AS has_provider_cancellation_scheduled_at,
      to_regclass('public.erp_sync_jobs') IS NOT NULL AS has_erp_sync_jobs,
      to_regclass('public.erp_product_mappings') IS NOT NULL AS has_erp_product_mappings,
      to_regclass('public.erp_webhook_routes') IS NOT NULL AS has_erp_webhook_routes
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
  if (!postDeploySchema.has_erp_sync_jobs || !postDeploySchema.has_erp_product_mappings || !postDeploySchema.has_erp_webhook_routes) {
    const { rows: dependencyRows } = await verificationClient.query(`
      SELECT
        to_regclass('public.erp_connections') IS NOT NULL AS has_erp_connections,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'erp_connections'
            AND column_name = 'direction_mode'
        ) AS has_direction_mode
    `);
    if (!dependencyRows[0].has_erp_connections || !dependencyRows[0].has_direction_mode) {
      throw new Error("Expected ERP connection schema before durable ERP repair");
    }
    console.log("Repairing durable ERP sync schema drift");
    await repairDurableErpSyncSchema(verificationClient);
    const { rows: repairedRows } = await verificationClient.query(`
      SELECT
        to_regclass('public.erp_sync_jobs') IS NOT NULL AS has_erp_sync_jobs,
        to_regclass('public.erp_product_mappings') IS NOT NULL AS has_erp_product_mappings,
        to_regclass('public.erp_webhook_routes') IS NOT NULL AS has_erp_webhook_routes
    `);
    if (!repairedRows[0].has_erp_sync_jobs || !repairedRows[0].has_erp_product_mappings || !repairedRows[0].has_erp_webhook_routes) {
      throw new Error("Durable ERP schema repair did not create required tables");
    }
  }
} finally {
  await verificationClient.end();
}

// Reserved showroom catalog seeding is opt-in per deployment. Operators set a
// valid storefront slug only for the one deployment that needs the catalog,
// then remove the variable before subsequent releases.
const reservedCatalogMerchantSlug = process.env.RUN_RESERVED_CATALOG_SEED;
if (reservedCatalogMerchantSlug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reservedCatalogMerchantSlug)) {
    throw new Error("RUN_RESERVED_CATALOG_SEED must be a lowercase storefront slug");
  }
  console.log(`Seeding reserved showroom catalog for ${reservedCatalogMerchantSlug}`);
  const seedPath = fileURLToPath(new URL("../prisma/seeds/advanced-product-layout-seed.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", seedPath],
    {
      stdio: "inherit",
      env: { ...process.env, AACP_DEMO_MERCHANT_SLUG: reservedCatalogMerchantSlug },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Reserved showroom catalog seed failed${result.error ? `: ${result.error.message}` : ""}`);
  }
}
