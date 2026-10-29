import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const [url, runId] = process.argv.slice(2);
assert.equal(process.argv.slice(2).length, 2);
const parsedUrl = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsedUrl.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "optional_cost_native_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const review = await readFile(new URL("../prisma/migrations/20261019100000_incentive_optional_cost/migration.sql", import.meta.url), "utf8");
const deploy = await readFile(new URL("../prisma/deploy-migrations/20261019100000_incentive_optional_cost/migration.sql", import.meta.url), "utf8");
assert.equal(review, deploy);
const ddl = value => {
  const statement = value.split("\n").filter(line => !line.trim().startsWith("--")).join("\n").trim();
  assert.equal(statement, 'ALTER TABLE "strategy_incentive_assignments" ALTER COLUMN "cost_cents" DROP NOT NULL;');
  return statement;
};
const assignments = client => client.strategyIncentiveAssignment;
const insert = (client, data) => assignments(client).create({ data });
const rawInsert = (client, data) => client.$executeRawUnsafe(
  "INSERT INTO strategy_incentive_assignments(id,merchant_id,execution_id,session_id,buyer_id,arm,assigned_at,cart_hash,amount_cents,cost_cents,reservation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
  data.id, data.merchantId, data.executionId, data.sessionId, data.buyerId, data.arm, data.assignedAt, data.cartHash, data.amountCents, data.costCents, data.reservationId);
const row = (id, overrides = {}) => ({ id, merchantId: "merchant", executionId: "execution", sessionId: id, buyerId: `buyer-${id}`, arm: "control",
  assignedAt: new Date("2030-01-02T00:00:00Z"), cartHash: "a".repeat(64), amountCents: 0, costCents: null, reservationId: null, ...overrides });
const nullable = async client => (await client.$queryRaw`SELECT attnotnull FROM pg_attribute WHERE attrelid='strategy_incentive_assignments'::regclass AND attname='cost_cents'`)[0].attnotnull === false;
const authorities = async client => ({
  constraints: await client.$queryRaw`SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='strategy_incentive_assignments'::regclass ORDER BY conname`,
  triggers: await client.$queryRaw`SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='strategy_incentive_assignments'::regclass AND NOT tgisinternal ORDER BY tgname`,
  guard: await client.$queryRaw`SELECT pg_get_functiondef('guard_incentive_assignment()'::regprocedure) AS definition`,
});
const rejects = async (work, code, pattern) => assert.rejects(work, error => {
  const message = String(error?.meta?.message ?? error?.message);
  assert.ok(error?.code === code || error?.meta?.code === code, `expected ${code}, got ${error?.code}/${error?.meta?.code}: ${message}`);
  if (pattern) assert.match(message, pattern);
  return true;
});
let passed = 0, active = "owned disposable identity";
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
try {
  await prisma.$connect();
  assert.deepEqual(await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`, [{ database: "storefront_synthetic", run_id: runId }]);
  await prisma.$executeRaw`INSERT INTO merchants VALUES ('merchant')`;
  await prisma.$executeRaw`INSERT INTO strategy_incentive_budgets VALUES ('budget','merchant',NULL)`;
  // Future synthetic interval guarantees original clock prerequisite remains true;
  // no clock mocking and no activation of a real experiment.
  await prisma.$executeRaw`INSERT INTO strategy_incentive_executions VALUES ('execution','merchant','strategy',1,'budget','2030-01-01','2100-01-01')`;
  await prisma.$executeRaw`INSERT INTO strategy_incentive_review_heads VALUES ('merchant','strategy',1,1)`;
  for (const id of ["legacy-known", "legacy-zero", "unknown-before", "rollback-review", "rollback-deploy", "unknown-after", "treatment", "negative-cost", "negative-amount", "invalid-hash", "invalid-arm", "invalid-control", "null-hash", "duplicate-buyer", "wrong-buyer", "rollback-write"]) {
    await prisma.$executeRaw`INSERT INTO checkout_sessions VALUES (${id},'merchant',${id},${id === "duplicate-buyer" ? "buyer-unknown-after" : `buyer-${id}`},'treatment','2030-01-02')`;
  }
  await prisma.$executeRaw`INSERT INTO strategy_incentive_reservations VALUES ('reservation','merchant','budget','treatment','buyer-treatment',250,'reserved')`;
  const columns = await prisma.$queryRaw`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='strategy_incentive_assignments' ORDER BY ordinal_position`;
  assert.equal(columns.length, 11);
  await insert(prisma, row("legacy-known", { costCents: 137 }));
  await insert(prisma, row("legacy-zero", { costCents: 0 }));
  const legacy = await assignments(prisma).findMany({ orderBy: { id: "asc" } });
  const frozen = await authorities(prisma);
  await check("historical NOT NULL refuses unknown cost through real generated Prisma", async () => {
    assert.equal(await nullable(prisma), false);
    await rejects(insert(prisma, row("unknown-before")), "P2011");
    assert.deepEqual(await assignments(prisma).findMany({ orderBy: { id: "asc" } }), legacy);
  });
  for (const [track, migration] of [["review", review], ["deploy", deploy]]) {
    await check(`${track} real DROP NOT NULL and null insert roll back together without backfill`, async () => {
      const sentinel = new Error(`owned-${track}-rollback`);
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(ddl(migration));
        assert.equal(await nullable(tx), true);
        const saved = await insert(tx, row(`rollback-${track}`));
        assert.equal(saved.costCents, null);
        throw sentinel;
      }), error => error === sentinel);
      assert.equal(await nullable(prisma), false);
      assert.deepEqual(await assignments(prisma).findMany({ orderBy: { id: "asc" } }), legacy);
      assert.deepEqual(await authorities(prisma), frozen);
    });
  }
  await check("review commit changes only nullability; deploy identical DDL is safe to execute again", async () => {
    await prisma.$executeRawUnsafe(ddl(review));
    assert.equal(await nullable(prisma), true);
    await prisma.$executeRawUnsafe(ddl(deploy));
    assert.deepEqual(await authorities(prisma), frozen);
    assert.deepEqual(await assignments(prisma).findMany({ orderBy: { id: "asc" } }), legacy);
    const after = await prisma.$queryRaw`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='strategy_incentive_assignments' ORDER BY ordinal_position`;
    assert.deepEqual(after, columns.map(column => column.column_name === "cost_cents" ? { ...column, is_nullable: "YES" } : column));
  });
  await check("Prisma roundtrip distinguishes unknown null, explicit historical zero and known nonzero", async () => {
    const unknown = await insert(prisma, row("unknown-after"));
    assert.equal(unknown.costCents, null);
    await insert(prisma, row("treatment", { arm: "treatment", amountCents: 250, reservationId: "reservation" }));
    assert.equal((await assignments(prisma).findUniqueOrThrow({ where: { id: "unknown-after" } })).costCents, null);
    assert.equal((await assignments(prisma).findUniqueOrThrow({ where: { id: "treatment" } })).costCents, null);
    assert.equal((await assignments(prisma).findUniqueOrThrow({ where: { id: "legacy-zero" } })).costCents, 0);
    assert.equal((await assignments(prisma).findUniqueOrThrow({ where: { id: "legacy-known" } })).costCents, 137);
  });
  await check("remaining CHECK, NOT NULL and UNIQUE constraints still reject malformed assignments", async () => {
    for (const [id, overrides, constraint] of [["negative-cost", { costCents: -1 }, /cost_cents_check/], ["negative-amount", { amountCents: -1 }, /amount_cents_check/],
      ["invalid-hash", { cartHash: "not-a-hash" }, /cart_hash_check/], ["invalid-arm", { arm: "other" }, /arm_check/], ["invalid-control", { amountCents: 1 }, /strategy_incentive_assignments_check/]])
      await rejects(rawInsert(prisma, row(id, overrides)), "23514", constraint);
    await rejects(prisma.$executeRaw`INSERT INTO strategy_incentive_assignments VALUES ('null-hash','merchant','execution','null-hash','buyer-null-hash','control','2030-01-02',NULL,0,NULL,NULL)`, "23502");
    await rejects(insert(prisma, row("unknown-after")), "P2002");
    await rejects(insert(prisma, row("duplicate-buyer", { buyerId: "buyer-unknown-after" })), "P2002");
  });
  await check("historical assignment immutability, ownership guard and referenced execution FK remain enforced", async () => {
    const before = await assignments(prisma).findMany({ orderBy: { id: "asc" } });
    await rejects(prisma.$executeRaw`UPDATE strategy_incentive_assignments SET cost_cents=0 WHERE id='unknown-after'`, "P0001", /immutable/);
    await rejects(prisma.$executeRaw`DELETE FROM strategy_incentive_assignments WHERE id='unknown-after'`, "P0001", /immutable/);
    await rejects(prisma.$executeRaw`DELETE FROM strategy_incentive_executions WHERE id='execution'`, "23503");
    await rejects(prisma.$executeRaw`INSERT INTO strategy_incentive_assignments VALUES ('wrong-buyer','merchant','execution','wrong-buyer','foreign-buyer','control','2030-01-02',${"a".repeat(64)},0,NULL,NULL)`, "P0001", /prerequisites changed/);
    assert.deepEqual(await assignments(prisma).findMany({ orderBy: { id: "asc" } }), before);
    assert.deepEqual(await authorities(prisma), frozen);
  });
  await check("post-migration nullable assignment still rolls back atomically without rewriting history", async () => {
    const before = await assignments(prisma).findMany({ orderBy: { id: "asc" } });
    const sentinel = new Error("owned-write-rollback");
    await assert.rejects(prisma.$transaction(async tx => { await insert(tx, row("rollback-write")); throw sentinel; }), error => error === sentinel);
    assert.deepEqual(await assignments(prisma).findMany({ orderBy: { id: "asc" } }), before);
  });
  console.log(JSON.stringify({ status: "passed", checks: passed, realProviderCalls: 0, assignmentFields: 11, migrationTracks: 2,
    unknownCostConvertedToZero: false, fullLedgerProof: false, productionMigrationApplied: false }));
} catch (error) { console.error(JSON.stringify({ status: "failed", active })); throw error; }
finally { await prisma.$disconnect(); }
