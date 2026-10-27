import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { repairRevenueFoundationFailure, revenueFoundationMigration } from "./revenue-foundation-repair.mjs";

const databaseUrl = process.env.REVENUE_FOUNDATION_TEST_DATABASE_URL;
const url = new URL(databaseUrl ?? "postgresql://invalid/disabled");
const enabled = ["localhost", "127.0.0.1"].includes(url.hostname)
  && url.port === "5432" && url.pathname === "/revenue_foundation_repair_0929";
if (databaseUrl && !enabled) throw new Error("Foundation repair tests require their disposable local database");
const migration = readFileSync(new URL(`../prisma/deploy-migrations/${revenueFoundationMigration}/migration.sql`, import.meta.url), "utf8");
const mirror = readFileSync(new URL(`../prisma/migrations/${revenueFoundationMigration}/migration.sql`, import.meta.url), "utf8");
const failed = { logs: 'Database error code: 42P07\nERROR: relation "ai_usage_events" already exists',
  finished_at: null, rolled_back_at: null };

// This is the shared telemetry shape independently audited in production.
// In particular its price lookup index uses the preexisting PostgreSQL name.
const existingTelemetry = `
CREATE TABLE ai_usage_events (
  id text NOT NULL PRIMARY KEY, idempotency_key text NOT NULL, provider_event_id text,
  merchant_id text NOT NULL, source text NOT NULL, channel text NOT NULL, component text NOT NULL,
  provider text NOT NULL, model text NOT NULL, execution_status text NOT NULL,
  prompt_tokens integer, completion_tokens integer, total_tokens integer, cost_micros bigint,
  currency text, pricing_version text, cost_status text NOT NULL DEFAULT 'unpriced',
  started_at timestamp(3) NOT NULL, completed_at timestamp(3) NOT NULL, latency_ms integer NOT NULL,
  conversation_id text, voice_session_id text, correlation_id text, parent_usage_event_id text,
  metadata jsonb, captured_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ai_usage_events_idempotency_key_key ON ai_usage_events(idempotency_key);
CREATE INDEX ai_usage_events_merchant_id_started_at_idx ON ai_usage_events(merchant_id, started_at);
CREATE INDEX ai_usage_events_merchant_id_channel_started_at_idx ON ai_usage_events(merchant_id, channel, started_at);
CREATE INDEX ai_usage_events_provider_provider_event_id_idx ON ai_usage_events(provider, provider_event_id);
CREATE INDEX ai_usage_events_conversation_id_started_at_idx ON ai_usage_events(conversation_id, started_at);
CREATE TABLE ai_price_versions (
  id text NOT NULL PRIMARY KEY, version text NOT NULL, provider text NOT NULL, model text NOT NULL,
  channel text NOT NULL, component text NOT NULL, currency text NOT NULL,
  input_micros_per_million bigint, output_micros_per_million bigint,
  effective_from timestamp(3) NOT NULL, effective_to timestamp(3), source text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ai_price_versions_version_key ON ai_price_versions(version);
CREATE INDEX ai_price_versions_provider_model_channel_component_effective_fr
  ON ai_price_versions(provider, model, channel, component, effective_from);
INSERT INTO ai_usage_events (id, idempotency_key, merchant_id, source, channel, component,
  provider, model, execution_status, started_at, completed_at, latency_ms, cost_micros, currency, metadata)
VALUES ('existing-usage', 'existing-key', 'existing-store', 'chat', 'chat', 'text_generation',
  'fixture', 'fixture-model', 'completed', '2026-09-01', '2026-09-01', 12, 123, 'BRL', '{"preserve":true}');
INSERT INTO ai_price_versions (id, version, provider, model, channel, component, currency,
  input_micros_per_million, output_micros_per_million, effective_from, source)
VALUES ('existing-price', 'existing-price-version', 'fixture', 'fixture-model', 'chat',
  'text_generation', 'BRL', 123, 456, '2026-09-01', 'existing-catalog');
`;

async function fixture(work) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `foundation_repair_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await work(client, schema);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    // Only this newly-created test schema, in the allowlisted disposable DB.
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
const integration = (name, work) => test(name, { skip: !enabled }, () => fixture(work));
async function snapshot(client) {
  const { rows } = await client.query(`SELECT 'usage' AS kind, to_jsonb(u) AS row FROM ai_usage_events u
    UNION ALL SELECT 'price', to_jsonb(p) FROM ai_price_versions p ORDER BY kind`);
  return rows;
}
async function assertFoundation(client) {
  const { rows: [result] } = await client.query(`SELECT
    to_regclass('revenue_analysis_schedules') IS NOT NULL AS schedules,
    to_regclass('revenue_analysis_runs') IS NOT NULL AS runs,
    to_regclass('revenue_ai_reservations') IS NOT NULL AS reservations`);
  assert.deepEqual(result, { schedules: true, runs: true, reservations: true });
}

test("Revenue foundation deploy and development migrations stay identical", () => assert.equal(migration, mirror));

integration("Revenue foundation installs clean and replays without changing table identities", async client => {
  await client.query(migration);
  await assertFoundation(client);
  const before = (await client.query("SELECT oid, relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace ORDER BY relname")).rows;
  await client.query(migration);
  assert.deepEqual((await client.query("SELECT oid, relname FROM pg_class WHERE relnamespace = current_schema()::regnamespace ORDER BY relname")).rows, before);
});

integration("Revenue foundation reuses audited telemetry and preserves every existing value", async client => {
  await client.query(existingTelemetry);
  const before = await snapshot(client);
  const beforeObjects = (await client.query("SELECT oid, relname, relowner FROM pg_class WHERE relnamespace = current_schema()::regnamespace ORDER BY relname")).rows;
  await client.query(migration);
  await client.query(migration);
  await assertFoundation(client);
  assert.deepEqual(await snapshot(client), before);
  const objects = (await client.query("SELECT oid, relname, relowner FROM pg_class WHERE relnamespace = current_schema()::regnamespace ORDER BY relname")).rows;
  for (const object of beforeObjects) assert.deepEqual(objects.find(row => row.oid === object.oid), object);
});

integration("Revenue predeploy repairs only verified collisions before resolving history for replay", async client => {
  await client.query(existingTelemetry);
  const before = await snapshot(client), resolved = [];
  assert.equal(await repairRevenueFoundationFailure(client, failed, async args => {
    await assertFoundation(client);
    assert.deepEqual(await snapshot(client), before);
    resolved.push(args);
  }), true);
  assert.deepEqual(resolved, [["migrate", "resolve", "--rolled-back", revenueFoundationMigration]]);
  await client.query(migration);
  assert.deepEqual(await snapshot(client), before);
});

for (const [name, mutate, expected] of [
  ["column type", "ALTER TABLE ai_usage_events ALTER COLUMN cost_micros TYPE numeric", /INCOMPATIBLE_COLUMNS/],
  ["nullability", "ALTER TABLE ai_usage_events ALTER COLUMN merchant_id DROP NOT NULL", /INCOMPATIBLE_COLUMNS/],
  ["default", "ALTER TABLE ai_usage_events ALTER COLUMN cost_status SET DEFAULT 'unknown'", /INCOMPATIBLE_DEFAULTS/],
  ["index columns", "DROP INDEX ai_usage_events_idempotency_key_key; CREATE UNIQUE INDEX ai_usage_events_idempotency_key_key ON ai_usage_events(provider_event_id)", /INCOMPATIBLE_INDEXES/],
  ["index uniqueness", "DROP INDEX ai_usage_events_idempotency_key_key; CREATE INDEX ai_usage_events_idempotency_key_key ON ai_usage_events(idempotency_key)", /INCOMPATIBLE_INDEXES/],
]) integration(`Revenue predeploy refuses incompatible ${name} atomically and does not resolve history`, async client => {
  await client.query(existingTelemetry);
  await client.query(mutate);
  const before = await snapshot(client);
  let resolved = false;
  await assert.rejects(repairRevenueFoundationFailure(client, failed, () => { resolved = true; }), expected);
  assert.equal(resolved, false);
  assert.deepEqual(await snapshot(client), before);
  assert.equal((await client.query("SELECT to_regclass('revenue_analysis_runs') AS relation")).rows[0].relation, null);
});

integration("Revenue predeploy rejects unexpected failures without schema or history changes", async client => {
  await client.query(existingTelemetry);
  const before = await snapshot(client);
  let resolved = false;
  for (const logs of ['Database error code: 42701\ncolumn already exists',
    'Database error code: 42P07\nERROR: relation "unrelated_table" already exists']) {
    await assert.rejects(repairRevenueFoundationFailure(client, { ...failed, logs }, () => { resolved = true; }), /unexpected failed/);
  }
  assert.equal(resolved, false); assert.deepEqual(await snapshot(client), before);
  assert.equal((await client.query("SELECT to_regclass('revenue_analysis_runs') AS relation")).rows[0].relation, null);
});

integration("Revenue predeploy refuses a collision record when shared tables are missing", async client => {
  let resolved = false;
  await assert.rejects(repairRevenueFoundationFailure(client, failed, () => { resolved = true; }), /Expected shared AI telemetry/);
  assert.equal(resolved, false);
  assert.equal((await client.query("SELECT to_regclass('ai_usage_events') AS relation")).rows[0].relation, null);
});

test("Revenue predeploy leaves absent, successful and already rolled-back records untouched", async () => {
  const unused = { async query() { assert.fail("No database work expected"); } };
  for (const row of [undefined, { ...failed, finished_at: new Date() }, { ...failed, rolled_back_at: new Date() }]) {
    assert.equal(await repairRevenueFoundationFailure(unused, row, () => assert.fail("No history change expected")), false);
  }
});
