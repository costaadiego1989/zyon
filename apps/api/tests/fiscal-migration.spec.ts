import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createFiscalFixture, fiscalMigrationInvariants } from "./fiscal-fixture.js";
import { seedFiscalSale } from "./fiscal-schema-seed.js";
import { preparePublishedFiscalBaseline, requirePublishedFiscalBaselineTarget, PUBLISHED_FISCAL_BASELINE_REVISION, PUBLISHED_FISCAL_BASELINE_SCHEMA_SHA256 } from "./fiscal-published-baseline.fixture.js";

const require = createRequire(import.meta.url);
const api = fileURLToPath(new URL("../", import.meta.url));
const history = join(api, "prisma/deploy-migrations");
const migrationName = "20261114120000_fiscal_invoicing";
const migration = () => readFileSync(join(history, migrationName, "migration.sql"), "utf8");
const fiscalFollowups = ["20261115170000_fiscal_durable_stages", "20261115190000_fiscal_artifact_immutability", "20261115200000_fiscal_delivery_binding", "20261115210000_fiscal_cancellation_fence", "20261115220000_fiscal_protected_setup", "20261115230000_private_payment_receipt", "20261118140000_fiscal_olist_oauth"];

test("published model baseline upgrades with all eight fiscal migrations and repeat deploy is unchanged", { timeout: 180_000 }, async t => {
  requirePublishedFiscalBaselineTarget();
  const fixture = await createFiscalFixture({ initializeSchema: false });
  t.after(() => fixture.close());
  const baseline = await preparePublishedFiscalBaseline(fixture);
  t.diagnostic(JSON.stringify(baseline));
  assert.equal(baseline.revision, PUBLISHED_FISCAL_BASELINE_REVISION);
  assert.equal(baseline.schemaSha256, PUBLISHED_FISCAL_BASELINE_SCHEMA_SHA256);
  const deploy = () => execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    cwd: api, env: { ...process.env, DATABASE_URL: fixture.databaseUrl }, encoding: "utf8", stdio: "pipe", timeout: 150_000,
  });
  deploy();
  const result = await fixture.sql.query("SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = $1", [migrationName]);
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows[0].finished_at);
  const applied = (await fixture.sql.query("SELECT id, migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name")).rows;
  const fiscalNames = [migrationName, ...fiscalFollowups].sort();
  assert.equal(fiscalNames.length, 8);
  assert.deepEqual(applied.map(row => row.migration_name), [...baseline.representedMigrations, ...fiscalNames].sort());
  for (const name of fiscalNames) {
    const row = applied.find(row => row.migration_name === name)!;
    assert.ok(row.finished_at);
    assert.equal(row.applied_steps_count, 1);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(join(history, name, "migration.sql"))).digest("hex"));
  }
  assert.match(deploy(), /No pending migrations to apply/);
  assert.deepEqual((await fixture.sql.query("SELECT id, migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name")).rows, applied);
  assert.equal((await fixture.sql.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'fiscal_%'", [fixture.schema])).rows[0].count, 12);
  const tables = (await fixture.sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'fiscal_%' ORDER BY table_name", [fixture.schema])).rows.map(row => row.table_name);
  assert.deepEqual(tables, ["fiscal_artifacts", "fiscal_cancellation_reviews", "fiscal_connections", "fiscal_deliveries", "fiscal_documents", "fiscal_events", "fiscal_intents", "fiscal_issuance_revisions", "fiscal_olist_oauth_sessions", "fiscal_profile_versions", "fiscal_provider_stage_receipts", "fiscal_sale_snapshots"]);
  assert.match((await fixture.sql.query("SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'fiscal_connections_one_active'", [fixture.schema])).rows[0].indexdef, /UNIQUE.*WHERE is_active/);
});

test("all eight fiscal SQL migrations upgrade published-model prior data without changing prior indexes or rows", { timeout: 180_000 }, async t => {
  requirePublishedFiscalBaselineTarget();
  const fixture = await createFiscalFixture({ initializeSchema: false });
  t.after(() => fixture.close());
  const baseline = await preparePublishedFiscalBaseline(fixture);
  t.diagnostic(JSON.stringify(baseline));
  const legacy = baseline.representedMigrations;
  assert.equal(baseline.revision, PUBLISHED_FISCAL_BASELINE_REVISION);
  assert.equal(baseline.schemaSha256, PUBLISHED_FISCAL_BASELINE_SCHEMA_SHA256);
  assert.ok(legacy.includes("20261114150000_cashback_combination"));
  const id = fixture.tag + "_existing_merchant";
  await fixture.sql.query("INSERT INTO merchants (id, name, updated_at) VALUES ($1, $2, now())", [id, "Loja anterior à emissão fiscal"]);
  const before = (await fixture.sql.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname", [fixture.schema])).rows;
  await fixture.sql.query(migration());
  assert.deepEqual((await fixture.sql.query("SELECT id, name FROM merchants WHERE id = $1", [id])).rows, [{ id, name: "Loja anterior à emissão fiscal" }]);
  const after = (await fixture.sql.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename NOT LIKE 'fiscal_%' ORDER BY tablename, indexname", [fixture.schema])).rows;
  assert.deepEqual(after, before);
  assert.equal((await fixture.sql.query("SELECT count(*)::integer AS count FROM fiscal_intents")).rows[0].count, 0);
  for (const name of [...fiscalFollowups].sort()) await fixture.sql.query(readFileSync(join(history, name, "migration.sql"), "utf8"));
  assert.deepEqual((await fixture.sql.query("SELECT id, name FROM merchants WHERE id = $1", [id])).rows, [{ id, name: "Loja anterior à emissão fiscal" }]);
  assert.deepEqual((await fixture.sql.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename NOT LIKE 'fiscal_%' ORDER BY tablename, indexname", [fixture.schema])).rows, before);
  for (const [table, column] of [["fiscal_connections", "setup_cipher"], ["payment_intents", "private_receipt"], ["fiscal_deliveries", "callback_credential_cipher"]]) {
    assert.equal((await fixture.sql.query("SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3", [fixture.schema, table, column])).rows[0].count, 1);
  }
  const immutableTriggers = ["fiscal_callback_credential_immutable", "private_payment_receipt_immutable"];
  assert.deepEqual((await fixture.sql.query("SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgname=ANY($2::text[]) ORDER BY t.tgname", [fixture.schema, immutableTriggers])).rows.map(row => row.tgname), immutableTriggers);
  const sale = await seedFiscalSale(fixture, { merchantId: id });
  const loaded = await fixture.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: sale.intent.id }, include: { connection: true, snapshot: true, profile: true } });
  assert.equal(loaded.connection.id, sale.connection.id);
  assert.equal(loaded.connection.setupCipher, null);
  assert.equal(loaded.snapshot.completedOrderId, sale.completedOrder.id);
  assert.equal(loaded.profile.id, sale.profile.id);
  const privateReceipt = { kind: "synthetic_upgrade_immutability_fixture", originalValue: 17 };
  const payment = await fixture.prisma.paymentIntent.create({ data: { id: fixture.tag + "_existing_payment", merchantId: id, sessionId: sale.completedOrder.sessionId, idempotencyKey: "upgrade-immutability", amountCents: 1000, currency: "BRL", method: "pix", status: "pending", privateReceipt } });
  await assert.rejects(fixture.sql.query("UPDATE payment_intents SET private_receipt=$1::jsonb WHERE id=$2", [JSON.stringify({ ...privateReceipt, originalValue: 18 }), payment.id]), /private_payment_receipt_immutable/);
  assert.deepEqual((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).privateReceipt, privateReceipt);
  assert.deepEqual((await fixture.sql.query("SELECT id, name FROM merchants WHERE id = $1", [id])).rows, [{ id, name: "Loja anterior à emissão fiscal" }]);
  assert.deepEqual((await fixture.sql.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename NOT LIKE 'fiscal_%' ORDER BY tablename, indexname", [fixture.schema])).rows, before);
});

test("db-push fixtures apply the exact production fiscal invariants", { timeout: 180_000 }, async t => {
  const fixture = await createFiscalFixture();
  t.after(() => fixture.close());
  assert.ok(migration().includes(fiscalMigrationInvariants()));
  const sale = await seedFiscalSale(fixture);
  const { prisma, sql } = fixture;

  await t.test("one active issuer is enforced by PostgreSQL while environments remain separate", async () => {
    const activatedAt = new Date();
    await prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt } });
    await assert.rejects(prisma.fiscalConnection.create({ data: { merchantId: sale.merchantId, environment: "homologation", provider: "bling", issuerTaxId: "12ABC34501DE35", isActive: true, activatedAt } }), { code: "P2002" });
    await prisma.fiscalConnection.create({ data: { merchantId: sale.merchantId, environment: "production", provider: "focus", issuerTaxId: "12ABC34501DE35", isActive: true, activatedAt } });
    assert.equal(await prisma.fiscalConnection.count({ where: { merchantId: sale.merchantId, isActive: true } }), 2);
  });

  const document = await prisma.fiscalDocument.create({ data: { merchantId: sale.merchantId, environment: sale.environment, intentId: sale.intent.id,
    issuerTaxId: "12ABC34501DE35", state: "authorized", number: "17", series: "1", accessKey: "test_key", authorizationProtocol: "test_protocol", authorizedAt: new Date() } });
  const xml = Buffer.from("<nfeProc><tpAmb>2</tpAmb></nfeProc>");
  const sha256 = createHash("sha256").update(xml).digest("hex");
  const insertArtifact = (content: Buffer, size: number) => sql.query(
    "INSERT INTO fiscal_artifacts (id, merchant_id, environment, document_id, kind, private_object_key, content, sha256, size, mime_type, retrieved_at) VALUES ($1,$2,$3,$4,'xml',$5,$6,$7,$8,'application/xml',now())",
    ["artifact_" + size, sale.merchantId, sale.environment, document.id, "private_" + size, content, sha256, size]);

  await t.test("activation and profile confirmation cannot omit their required evidence", async () => {
    await assert.rejects(sql.query("UPDATE fiscal_connections SET activated_at = NULL WHERE id = $1", [sale.connection.id]), { code: "23514" });
    await assert.rejects(sql.query("UPDATE fiscal_profile_versions SET confirmed_by = NULL WHERE id = $1", [sale.profile.id]), { code: "23514" });
    const profile = await prisma.fiscalProfileVersion.findUniqueOrThrow({ where: { id: sale.profile.id } });
    assert.equal(profile.confirmedBy, fixture.tag + "_owner");
    assert.equal(profile.confirmedAt?.toISOString(), "2026-11-14T12:00:00.000Z");
  });

  await t.test("artifact content size and the 20 MiB ceiling are enforced in the database", async () => {
    await assert.rejects(insertArtifact(xml, xml.length + 1), { code: "23514" });
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 32);
    await assert.rejects(insertArtifact(oversized, oversized.length), { code: "23514" });
    assert.equal(await prisma.fiscalArtifact.count(), 0);
    await insertArtifact(xml, xml.length);
    const value = await prisma.fiscalArtifact.findFirstOrThrow({ where: { documentId: document.id } });
    assert.equal(value.sha256, sha256);
    assert.deepEqual(Buffer.from(value.content), xml);
  });

  await t.test("authorized identifiers and confirmed states cannot be overwritten by a direct update", async () => {
    await assert.rejects(sql.query("UPDATE fiscal_documents SET number = '18' WHERE id = $1", [document.id]), { code: "23514" });
    await assert.rejects(sql.query("UPDATE fiscal_documents SET state = 'processing' WHERE id = $1", [document.id]), { code: "23514" });
    const value = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(value.number, "17");
    assert.equal(value.state, "authorized");
    assert.equal(value.authorizationProtocol, "test_protocol");
  });

  await t.test("fiscal audit events are append-only even outside the repository", async () => {
    const event = await prisma.fiscalEvent.create({ data: { merchantId: sale.merchantId, environment: sale.environment, intentId: sale.intent.id, actorKind: "system", action: "authorized" } });
    await assert.rejects(sql.query("UPDATE fiscal_events SET action = 'changed' WHERE id = $1", [event.id]), { code: "23514" });
    await assert.rejects(sql.query("DELETE FROM fiscal_events WHERE id = $1", [event.id]), { code: "23514" });
    assert.equal((await prisma.fiscalEvent.findUniqueOrThrow({ where: { id: event.id } })).action, "authorized");
  });
});
