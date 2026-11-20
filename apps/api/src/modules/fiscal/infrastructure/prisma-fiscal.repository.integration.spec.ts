import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PrismaFiscalRepository } from "./prisma-fiscal.repository.js";

const run = promisify(execFile);

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { fixture = await createFiscalFixture(); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange(stage: number) {
  const repo = new PrismaFiscalRepository(fixture.prisma);
  const sale = await seedFiscalSale(fixture);
  const scope = { merchantId: sale.merchantId, environment: sale.environment };
  const actor = { actorKind: "worker", actorId: "worker_a" };
  const data = { ...sale.intentData, operation: "sale" as const };
  await fixture.prisma.fiscalIntent.delete({ where: { id: sale.intent.id } });
  const worker = async (action: string, input: unknown) => {
    const result = await run(process.execPath, ["--loader", "./apps/api/tests/platform-support-loader.mjs", "./apps/api/tests/fiscal-repository-worker.ts", action, JSON.stringify(input)], {
      env: { ...process.env, FISCAL_WORKER_DATABASE_URL: fixture.databaseUrl },
    });
    return JSON.parse(result.stdout.trim());
  };
  const intent = stage === 0 ? sale.intent : await repo.createIntent(data, actor);
  const now = new Date();
  let first = intent;
  if ([2, 3, 4, 8].includes(stage)) {
    first = (await repo.claim(scope, now, 10000))!;
    if (stage !== 2) {
      await repo.updateClaim(scope, first.id, first.leaseToken!, first.version, now, { writeStage: "submit", writeStartedAt: now }, { ...actor, action: "write_started" });
      await repo.claim(scope, new Date(now.getTime() + 10001), 10000);
    }
  }
  return { repo, sale, scope, actor, data, worker, intent, now, first };
}
test("FISCAL-28 independent processes create exactly one stable intention and event", async () => {
  const { scope, actor, data, worker } = await arrange(0);
  const values = await Promise.all([worker("create", { data, actor }), worker("create", { data, actor })]);
  assert.equal(values[0].id, values[1].id);
  assert.equal(await fixture.prisma.fiscalIntent.count({ where: scope }), 1);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: scope }), 1);
  assert.equal(values[0].stableReference, data.stableReference);
});
test("separate processes claim a queued operation only once", async () => {
  const { repo, scope, worker, intent, now } = await arrange(1);
  const values = await Promise.all([worker("claim", { scope, now, leaseMs: 10000 }), worker("claim", { scope, now, leaseMs: 10000 })]);
  assert.equal(values.filter(Boolean).length, 1);
  assert.equal(values.find(Boolean).id, intent.id);
  assert.equal((await repo.findIntent(scope, intent.id))?.attempts, 1);
});
test("FISCAL-31 expired started writes resume reconciliation with the same reference", async () => {
  const { repo, scope, actor, data, now, first } = await arrange(2);
  assert.equal(await repo.updateClaim(scope, first.id, first.leaseToken!, first.version, now, { writeStage: "submit", writeStartedAt: now }, { ...actor, action: "write_started" }), true);
  const claimed = await repo.claim(scope, new Date(now.getTime() + 10001), 10000);
  assert.equal(claimed?.state, "reconciliation_required");
  assert.equal(claimed?.stableReference, data.stableReference);
  assert.equal(claimed?.attempts, 2);
  assert.notEqual(claimed?.leaseToken, first.leaseToken);
});
test("an old worker cannot persist after lease expiration or replacement", async () => {
  const { repo, scope, actor, now, first } = await arrange(3);
  assert.equal(await repo.updateClaim(scope, first.id, first.leaseToken!, first.version, new Date(now.getTime() + 10002), { remoteInvoiceId: "stale_invoice" }, { ...actor, action: "stale" }), false);
  assert.equal((await repo.findIntent(scope, first.id))?.remoteInvoiceId, null);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: { ...scope, action: "stale" } }), 0);
});
test("a current fenced claim persists its remote reference and history together", async () => {
  const { repo, scope, actor, intent, now } = await arrange(4);
  const current = (await repo.findIntent(scope, intent.id))!;
  assert.equal(await repo.updateClaim(scope, current.id, current.leaseToken!, current.version, new Date(now.getTime() + 10003), { remoteOrderId: "remote_sale" }, { ...actor, action: "remote_order_found", providerEvidenceRef: "remote_sale" }), true);
  assert.equal((await repo.findIntent(scope, intent.id))?.remoteOrderId, "remote_sale");
  assert.equal((await repo.history(scope, intent.id)).at(-1)?.providerEvidenceRef, "remote_sale");
});
test("FISCAL-38 every read and claim excludes another merchant and environment", async () => {
  const { repo, scope, intent, now } = await arrange(5);
  assert.equal(await repo.findIntent({ ...scope, merchantId: "other" }, intent.id), null);
  assert.equal(await repo.findIntent({ ...scope, environment: "production" }, intent.id), null);
  assert.deepEqual(await repo.history({ ...scope, merchantId: "other" }, intent.id), []);
  assert.equal(await repo.claim({ ...scope, environment: "production" }, now, 10000), null);
});
test("foreign connection scope is rejected by actual database constraints", async () => {
  const { repo, actor, data } = await arrange(6);
  const other = await seedFiscalSale(fixture);
  await assert.rejects(repo.createIntent({ ...data, orderId: "bad_scope", connectionId: other.connection.id }, actor));
  assert.equal(await fixture.prisma.fiscalIntent.count({ where: { orderId: "bad_scope" } }), 0);
});
test("FISCAL-64 a failed transaction retains neither intention nor event", async () => {
  const { repo, scope, actor, data, intent } = await arrange(7);
  await assert.rejects(repo.transaction(async tx => {
    await tx.createIntent({ ...data, orderId: "rollback", stableReference: "rollback" }, actor);
    throw new Error("injected_failure");
  }), /injected_failure/);
  assert.equal(await fixture.prisma.fiscalIntent.count({ where: { ...scope, orderId: "rollback" } }), 0);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: { ...scope, action: "created", intent: { orderId: "rollback" } } }), 0);
});
test("failure writing history rolls back the fenced state update", async () => {
  const { repo, scope, intent, now } = await arrange(8);
  const current = (await repo.findIntent(scope, intent.id))!;
  await assert.rejects(repo.updateClaim(scope, current.id, current.leaseToken!, current.version, new Date(now.getTime() + 10004), { remoteInvoiceId: "must_rollback" }, { actorKind: null as never, action: "invalid_event" }));
  const persisted = (await repo.findIntent(scope, intent.id))!;
  assert.equal(persisted.remoteInvoiceId, null);
  assert.equal(persisted.version, current.version);
});
test("FISCAL-56 summaries contain the order provider recipient state and channel status", async () => {
  const { repo, sale, scope, data, intent } = await arrange(9);
  const document = await fixture.prisma.fiscalDocument.create({ data: { ...scope, intentId: intent.id, issuerTaxId: sale.connection.issuerTaxId } });
  await fixture.prisma.fiscalDelivery.create({ data: { ...scope, documentId: document.id, channel: "email", responsibleSender: "zyon", state: "blocked" } });
  const list = await repo.list(scope, {});
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].orderId, sale.orderId);
  assert.equal(list.items[0].provider, "focus");
  assert.equal(list.items[0].recipientName, (sale.snapshot.recipient as { name: string }).name);
  assert.deepEqual(list.items[0].deliveries, [{ channel: "email", state: "blocked" }]);
  assert.equal(JSON.stringify(list).includes("52998224725"), false);
  assert.equal(JSON.stringify(list).includes("synthetic-cipher"), false);
});
test("FISCAL-57 search filtered counts and pagination are computed in tenant scope", async () => {
  const { repo, scope, actor, data } = await arrange(10);
  await repo.createIntent({ ...data, orderId: "search_sale", stableReference: "search_sale", state: "rejected" }, actor);
  const list = await repo.list(scope, { search: "search_", state: "rejected", page: 1, pageSize: 1 });
  assert.equal(list.total, 1);
  assert.equal(list.items[0].orderId, "search_sale");
  assert.deepEqual(list.counts, { rejected: 1 });
  assert.equal((await repo.list(scope, { search: "search_", page: 2, pageSize: 1 })).items.length, 0);
  assert.equal((await repo.list({ ...scope, merchantId: "other" }, {})).total, 0);
});
test("FISCAL-60 history preserves actor timestamp order original provider environment and result", async () => {
  const { repo, sale, scope, worker, intent } = await arrange(11);
  const event = (await repo.history(scope, intent.id))[0];
  assert.equal(event.actorId, "worker_a");
  assert.equal(event.actorKind, "worker");
  assert.equal(event.action, "created");
  assert.equal(event.nextState, "queued");
  assert.equal(event.orderId, sale.orderId);
  assert.equal(event.provider, "focus");
  assert.equal(event.environment, "homologation");
  assert.ok(event.occurredAt instanceof Date);
});

test("lease interval bounds cannot produce an unbounded claim", async () => {
  const { repo, scope, now, intent } = await arrange(1);
  await assert.rejects(repo.claim(scope, now, 0), /fiscal_lease_invalid/);
  await assert.rejects(repo.claim(scope, now, 600001), /fiscal_lease_invalid/);
  assert.equal((await repo.findIntent(scope, intent.id))?.leaseToken, null);
});
