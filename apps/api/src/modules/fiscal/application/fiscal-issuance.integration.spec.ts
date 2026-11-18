import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PrismaFiscalRepository } from "../infrastructure/prisma-fiscal.repository.js";
import { PrismaFiscalIssuanceStore } from "../infrastructure/prisma-fiscal-issuance.store.js";
import { FiscalIssuanceService } from "./fiscal-issuance.service.js";
import { FiscalProviderFactory } from "../infrastructure/fiscal-provider.factory.js";
import { admitFiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";
import type { FiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";

let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { f = await createFiscalFixture(); }, { timeout: 300000 });
after(async () => { await f?.close(); });
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { seedHistoricalFiscalIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { FiscalWorker } from "../infrastructure/fiscal.worker.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { PrismaFiscalOrderParticipant } from "../infrastructure/prisma-fiscal-order.participant.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";

test("FISCAL-32 accepted HTTP persists processing, the immutable producer payload and redacted durable stages", async () => {
  const a = await arrangeIssuance(f); await a.run(); const intent = await a.current();
  assert.equal(intent.state, "processing"); assert.equal(intent.remoteInvoiceId, a.sale.intent.stableReference);
  const document = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: intent.id } }); assert.equal(document.state, "processing"); assert.equal(document.accessKey, null);
  const revision = await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({ where: { intentId: intent.id } }); const body = a.writes()[0]!.body!;
  assert.equal(body.valor_total, 21.01); assert.equal(body.valor_produtos, 20); assert.equal(body.valor_desconto, 1.01); assert.equal(body.valor_frete, 2.02);
  assert.equal(body.items[0].quantidade_comercial, 2); assert.equal(body.items[0].valor_unitario_comercial, 10); assert.equal(body.items[0].codigo_ncm, "61091000"); assert.equal(body.items[0].cfop, "5102");
  assert.equal(body.cpf_destinatario, "52998224725"); assert.equal(body.cnpj_emitente, a.sale.connection.issuerTaxId); assert.equal(body.data_emissao, revision.issuedAt.toISOString());
  assert.deepEqual(body.formas_pagamento, [{ forma_pagamento: "03", valor_pagamento: 21.01, tipo_integracao: "1", cnpj_credenciadora: "12345678000195", numero_autorizacao: "ABC123", bandeira_operadora: "01", data_pagamento: "2026-11-14" }]);
  assert.equal(a.calls[0]!.authorization, "Basic " + Buffer.from("private_company_token:").toString("base64"));
  const stages = await f.prisma.fiscalProviderStageReceipt.findMany({ where: { intentId: intent.id } }); assert.equal(stages.length, 1); assert.equal(stages[0]!.outcome, "accepted"); assert.match(stages[0]!.payloadHash!, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stages).includes("private_company_token")); assert.ok(!JSON.stringify(stages).includes("52998224725"));
});
test("FISCAL-33 actual Focus query stores authorization with exact identifiers and history after an accepted write", async () => {
  const a = await arrangeIssuance(f); await a.run(); a.setRemote("authorized"); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await a.run();
  const doc = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  assert.equal((await a.current()).state, "authorized"); assert.equal(doc.number, "22"); assert.equal(doc.series, "1"); assert.equal(doc.authorizationProtocol, "151260029467289"); assert.equal(doc.authorizedAt!.toISOString(), "2026-11-14T15:00:00.000Z");
  assert.equal(doc.accessKey, "352611" + a.sale.connection.issuerTaxId + "550010000000221123456780"); assert.equal(doc.documentState, "document_pending"); assert.equal(a.writes().length, 1);
  assert.ok((await a.repo.history(a.scope, a.sale.intent.id)).some(e => e.action === "provider.authorized"));
});
test("FISCAL-29 timeout after remote acceptance persists uncertainty and restart queries without another POST", async () => {
  const a = await arrangeIssuance(f); a.setBehavior("timeout"); await a.run(); assert.equal((await a.current()).state, "reconciliation_required");
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); a.setRemote("absent"); await a.run();
  assert.equal(a.writes().length, 1); assert.equal((await a.current()).state, "reconciliation_required"); assert.equal((await f.prisma.fiscalProviderStageReceipt.findFirstOrThrow({ where: { intentId: a.sale.intent.id } })).outcome, "unknown");
});
test("FISCAL-29 a failed local finish preserves started and cannot replay after provider success", async () => {
  const a = await arrangeIssuance(f); const c = await a.claim(); const session = await a.store.open(c!); const journal = session.journal; const originalFinish = journal.finish.bind(journal); journal.finish = async () => false;
  const payload = a.factory.build(session.context, new Date().toISOString(), admitFiscalPaymentEvidence(a.sale.snapshot, a.evidence)); await session.freeze(payload, a.evidence);
  const adapter = a.factory.create(session.context, payload, journal); const result = await adapter.submit(session.context.identity, { payload, sendEmail: false }); assert.equal(result.outcome, "unknown");
  journal.finish = originalFinish; assert.equal((await journal.read(session.context.identity, "invoice.submit"))!.outcome, "started");
  const repeated = await adapter.submit(session.context.identity, { payload, sendEmail: false }); assert.equal(repeated.outcome, "unknown"); assert.equal(a.writes().length, 1);
});
test("FISCAL-31 independent client expires a claim and stale worker performs zero write IO", async () => {
  const a = await arrangeIssuance(f); const c = await a.claim(); const session = await a.store.open(c!); const other = new PrismaClient({ datasources: { db: { url: f.databaseUrl } } });
  try { await other.fiscalIntent.update({ where: { id: c!.id }, data: { leaseUntil: new Date(0), version: { increment: 1 } } }); const body = a.factory.build(session.context, new Date().toISOString(), admitFiscalPaymentEvidence(a.sale.snapshot, a.evidence));
    const result = await a.factory.create(session.context, body, session.journal).submit(session.context.identity, { payload: body, sendEmail: false }); assert.equal(result.outcome, "unknown"); assert.equal(a.writes().length, 0);
  } finally { await other.$disconnect(); }
});
test("FISCAL-64 concurrent suppression invalidates the exact old journal fence", async () => {
  const a = await arrangeIssuance(f); const c = await a.claim(); const s = await a.store.open(c!);
  await f.prisma.fiscalIntent.update({ where: { id: c!.id }, data: { state: "suppressed", version: { increment: 1 }, leaseToken: null } });
  assert.equal(await s.journal.begin({ identity: s.context.identity, stage: "invoice.submit", reference: c!.stableReference, payloadHash: "a".repeat(64), outcome: "started" }), false); assert.equal(await f.prisma.fiscalProviderStageReceipt.count({ where: { intentId: c!.id } }), 0);
});
test("FISCAL-34 authenticated rejection stores only normalized reason without private payload", async () => {
  const a = await arrangeIssuance(f); a.setRemote("rejected"); await a.run(); assert.equal((await a.current()).state, "rejected"); assert.equal((await a.current()).lastErrorCode, "sefaz_598");
  assert.ok(!(JSON.stringify(await a.repo.history(a.scope, a.sale.intent.id))).includes("private_company_token")); assert.equal(a.writes().length, 0);
});
test("FISCAL-35 explicit corrected rejection admits a new durable revision and actual Focus POST with the same sale", async () => {
  const a = await arrangeIssuance(f); await a.run(); a.setRemote("rejected"); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await a.run();
  const before = await f.prisma.fiscalIssuanceRevision.findMany({ where: { intentId: a.sale.intent.id } });
  await a.service.reprocess(a.scope, a.sale.intent.id, a.sale.profile.id, { actorKind: "merchant", actorId: "authorized_owner", permission: "fiscal.reprocess" }); await a.run();
  const revisions = await f.prisma.fiscalIssuanceRevision.findMany({ where: { intentId: a.sale.intent.id }, orderBy: { revision: "asc" } }); assert.equal(revisions.length, 2); assert.equal(a.writes().length, 2); assert.equal(revisions[0]!.payloadHash, before[0]!.payloadHash);
  assert.equal(a.writes()[0]!.body!.valor_total, a.writes()[1]!.body!.valor_total); assert.equal(a.writes()[0]!.body!.cpf_destinatario, a.writes()[1]!.body!.cpf_destinatario); assert.equal((await a.current()).stableReference, a.sale.intent.stableReference); assert.equal(revisions[1]!.revision, 2);
});
test("FISCAL-35 unknown and authorized documents cannot admit a new revision", async () => {
  for (const state of ["reconciliation_required", "authorized"]) { const a = await arrangeIssuance(f); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { state } });
    await assert.rejects(a.service.reprocess(a.scope, a.sale.intent.id, a.sale.profile.id, { actorKind: "merchant", actorId: "owner", permission: "fiscal.reprocess" }), /reprocess_not_allowed/); assert.equal(await f.prisma.fiscalIssuanceRevision.count({ where: { intentId: a.sale.intent.id } }), 0); }
});
test("FISCAL-36 explicit rate nonacceptance persists Retry-After and reuses the exact body and issuedAt", async () => {
  const a = await arrangeIssuance(f); a.setBehavior("429"); const start = Date.now(); await a.run(); assert.equal((await a.current()).state, "queued"); assert.ok((await a.current()).nextAttemptAt.getTime() >= start + 120000);
  a.setBehavior("normal"); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await a.run(); assert.deepEqual(a.writes()[0]!.body, a.writes()[1]!.body); assert.equal(await f.prisma.fiscalIssuanceRevision.count({ where: { intentId: a.sale.intent.id } }), 1);
});
for (const [instrument, code] of [["debit", "04"], ["dynamic_pix", "17"], ["static_pix", "20"]] as const) test("FISCAL-23 original " + instrument + " metadata maps its actual paid instrument and seller parcel", async () => {
  const a = await arrangeIssuance(f, { instrument }); await a.run(); const payment = a.writes()[0]!.body!.formas_pagamento[0]; assert.equal(payment.forma_pagamento, code); assert.equal(payment.valor_pagamento, 21.01); assert.notEqual(payment.valor_pagamento, 30);
});
test("FISCAL-23 missing private PSP evidence preserves paid order and creates merchant pending without buyer data request", async () => {
  const a = await arrangeIssuance(f); const service = new FiscalIssuanceService(a.store, a.factory, { read: async () => null }); await service.run((await a.claim())!);
  assert.equal((await a.current()).state, "action_required"); assert.equal((await a.current()).lastErrorCode, "fiscal_payment_evidence_required"); assert.equal(a.calls.length, 0); assert.equal((await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: a.sale.completedOrder.id } })).orderTotal.toNumber(), 21.01);
});
test("FISCAL-23 original account, tenant, provider, environment, operation, amount and currency must match authenticated evidence", async () => {
  const a = await arrangeIssuance(f); for (const [field, value] of [["accountId", "other"], ["merchantId", "other"], ["provider", "other"], ["environment", "live"], ["operationId", "other"], ["amountCents", 2102], ["currency", "USD"]]) {
    const evidence = structuredClone(a.evidence); (evidence.receipt as any)[field] = value; assert.throws(() => admitFiscalPaymentEvidence(a.sale.snapshot, evidence), /fiscal_payment_evidence_mismatch/);
  }
  assert.equal(a.calls.length, 0);
});
test("FISCAL-23 integrated card without actual acquirer or authorization metadata remains merchant pending", async () => {
  const a = await arrangeIssuance(f); delete a.evidence.receipt.authorizationCode; await a.run(); assert.equal((await a.current()).lastErrorCode, "fiscal_payment_metadata_required"); assert.equal(a.writes().length, 0);
});
test("FISCAL-29 contact unknown remains bound to its entity even when invoice is absent", async () => {
  const a = await arrangeIssuance(f); const s = await a.store.open((await a.claim())!); const record = { identity: s.context.identity, stage: "contact.create" as const, reference: s.context.identity.reference + ":contact", payloadHash: "a".repeat(64), outcome: "started" as const };
  assert.equal(await s.journal.begin(record), true); assert.equal(await s.journal.finish({ ...record, outcome: "unknown" }), true);
  assert.equal(await s.journal.begin({ ...record, stage: "invoice.submit", reference: s.context.identity.reference }), false);
  assert.equal((await s.journal.read(s.context.identity, "contact.create"))!.outcome, "unknown"); assert.equal(a.writes().length, 0);
});
test("FISCAL-64 journal rejects foreign identity and changed hash without modifying the original receipt", async () => {
  const a = await arrangeIssuance(f); const s = await a.store.open((await a.claim())!); const record = { identity: s.context.identity, stage: "invoice.submit" as const, reference: s.context.identity.reference, payloadHash: "a".repeat(64), outcome: "started" as const };
  assert.equal(await s.journal.begin(record), true); await assert.rejects(s.journal.read({ ...s.context.identity, environment: "production" }, "invoice.submit"), /identity_mismatch/);
  await assert.rejects(s.journal.finish({ ...record, payloadHash: "b".repeat(64), outcome: "accepted", remoteId: "x" }), /stage_content_immutable/); assert.equal((await s.journal.read(s.context.identity, "invoice.submit"))!.payloadHash, record.payloadHash);
});
test("FISCAL-31 accepted contact cursor updates persist through a new store without changing identity or hash", async () => {
  const a = await arrangeIssuance(f); const s = await a.store.open((await a.claim())!); const record = { identity: s.context.identity, stage: "contact.create" as const, reference: s.context.identity.reference + ":contact", payloadHash: "a".repeat(64), outcome: "started" as const };
  await s.journal.begin(record); await s.journal.finish({ ...record, outcome: "accepted", remoteId: "123", relatedIds: { source: "tax_id_match", recipientFingerprint: "frozen" } });
  await s.journal.finish({ ...record, outcome: "accepted", remoteId: "123", relatedIds: { source: "tax_id_match", recipientFingerprint: "frozen", orderLookupPage: "11" } });
  const value = await s.journal.read(s.context.identity, "contact.create"); assert.equal(value!.relatedIds!.orderLookupPage, "11"); assert.equal(value!.remoteId, "123"); assert.equal(value!.payloadHash, record.payloadHash);
});

for (const provider of ["bling", "omie", "tiny"] as const) test("FISCAL-29 " + provider + " compound stages persist each accepted entity and order-only acknowledgement never invents NF identity", async () => {
  const a = await arrangeIssuance(f, { provider }); let writes = 0;
  const factory = { build: () => ({ frozen: "synthetic-provider-contract" }), create: (context: any, _payload: unknown, journal: any) => {
    const write = async (stage: string, remoteId: string) => { const record = { identity: context.identity, stage, reference: context.identity.reference, payloadHash: "a".repeat(64), outcome: "started" };
      const old = await journal.read(context.identity, stage); if (old?.outcome === "accepted") return;
      assert.equal(await journal.begin(record), true); writes++; assert.equal(await journal.finish({ ...record, outcome: "accepted", remoteId }), true);
    };
    return { provider, capabilities: { salesOrder: true }, findByReference: async () => ({ found: false }), reconcileStage: async () => ({ found: false }),
      ensureOrder: async () => { await write("order.create", "order_1"); return { outcome: "accepted", value: { id: "order_1", reference: context.identity.reference } }; },
      generate: async () => { await write("invoice.validate", "order_1"); return { outcome: "accepted", value: { remoteOrderId: "order_1" } }; },
      submit: async () => { await write("invoice.submit", "order_1"); return { outcome: "accepted", value: { identity: context.identity, status: "processing", remoteOrderId: "order_1", providerStatus: "accepted", verifiedBy: "request_response" } }; } };
  } };
  const service = new FiscalIssuanceService(a.store, factory as never, a.payments); await service.run((await a.claim())!); assert.equal(writes, 3); assert.equal((await a.current()).remoteOrderId, "order_1"); assert.equal((await a.current()).remoteInvoiceId, null);
  assert.equal(await f.prisma.fiscalDocument.count({ where: { intentId: a.sale.intent.id } }), 0); assert.equal(await f.prisma.fiscalProviderStageReceipt.count({ where: { intentId: a.sale.intent.id, outcome: "accepted" } }), 3);
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await service.run((await a.claim())!); assert.equal(writes, 3);
});
test("FISCAL-64 disconnect after claim forbids a fresh durable stage begin", async () => {
  const a = await arrangeIssuance(f); const s = await a.store.open((await a.claim())!); await f.prisma.fiscalConnection.update({ where: { id: a.sale.connection.id }, data: { disconnectedAt: new Date() } });
  assert.equal(await s.journal.begin({ identity: s.context.identity, stage: "invoice.submit", reference: s.context.identity.reference, payloadHash: "a".repeat(64), outcome: "started" }), false); assert.equal(a.writes().length, 0);
});
test("FISCAL-64 immutable private revisions and scoped durable receipts retain their database constraints", async () => {
  const a = await arrangeIssuance(f); await a.run(); const revision = await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({ where: { intentId: a.sale.intent.id } });
  await assert.rejects(f.sql.query("UPDATE fiscal_issuance_revisions SET payload = '{}' WHERE id = $1", [revision.id]), { code: "23514" });
  const stage = await f.prisma.fiscalProviderStageReceipt.findFirstOrThrow({ where: { intentId: a.sale.intent.id } });
  await assert.rejects(f.prisma.fiscalProviderStageReceipt.create({ data: { ...stage, id: undefined } }), { code: "P2002" });
  await assert.rejects(f.prisma.fiscalProviderStageReceipt.create({ data: { ...stage, id: undefined, merchantId: "foreign", stage: "order.create" } }), { code: "P2003" });
  await assert.rejects(f.prisma.fiscalProviderStageReceipt.create({ data: { ...stage, id: undefined, environment: "production", stage: "order.create" } }), { code: "P2003" });
  await assert.rejects(f.prisma.fiscalIssuanceRevision.create({ data: { ...revision, id: undefined, merchantId: "foreign", revision: 2 } }), { code: "P2003" });
  await assert.rejects(f.prisma.fiscalIssuanceRevision.create({ data: { ...revision, id: undefined, environment: "production", revision: 2 } }), { code: "P2003" });
  assert.equal((await f.prisma.fiscalIssuanceRevision.findUniqueOrThrow({ where: { id: revision.id } })).payloadHash, revision.payloadHash);
});

test("FISCAL-35 actual corrected profile changes only the admitted fiscal revision and preserves frozen money and recipient", async () => {
  const a = await arrangeIssuance(f); await a.run(); a.setRemote("rejected"); await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await a.run();
  const config = structuredClone(a.sale.profile.itemRules) as any; config.items.shirt.cfop = "5101";
  const profile = await f.prisma.fiscalProfileVersion.create({ data: { merchantId: a.sale.merchantId, environment: a.sale.environment, provider: "focus", operation: "sale", version: 2, issuerRegime: "simples_nacional", itemRules: config,
    recipientRequirements: ["name", "taxId"], sourceContractVersion: "synthetic-v2", confirmedBy: "accountant", confirmedAt: new Date() } });
  await a.service.reprocess(a.scope, a.sale.intent.id, profile.id, { actorKind: "merchant", actorId: "authorized_owner", permission: "fiscal.reprocess" }); await a.run();
  assert.equal(a.writes().length, 2); assert.equal(a.writes()[0]!.body!.items[0].cfop, "5102"); assert.equal(a.writes()[1]!.body!.items[0].cfop, "5101");
  assert.equal(a.writes()[0]!.body!.valor_total, a.writes()[1]!.body!.valor_total); assert.equal(a.writes()[0]!.body!.cpf_destinatario, a.writes()[1]!.body!.cpf_destinatario);
  assert.equal((await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: a.sale.snapshot.id } })).contentHash, a.sale.snapshot.contentHash);
});

test("FISCAL-64 two independent processes admit exactly one durable entity write under the same lease version", async () => {
  const a = await arrangeIssuance(f); const claim = await a.claim(); const s = await a.store.open(claim!);
  const record = { identity: s.context.identity, stage: "invoice.submit", reference: s.context.identity.reference, payloadHash: "a".repeat(64), outcome: "started" };
  const invoke = () => promisify(execFile)(process.execPath, ["--loader", "./apps/api/tests/platform-support-loader.mjs", "./apps/api/tests/fiscal-repository-worker.ts", "stage.begin", JSON.stringify({ claim, record })], { env: { ...process.env, FISCAL_WORKER_DATABASE_URL: f.databaseUrl } });
  const results = await Promise.all([invoke(), invoke()]); assert.deepEqual(results.map(r => JSON.parse(r.stdout)).sort(), [false, true]);
  assert.equal(await f.prisma.fiscalProviderStageReceipt.count({ where: { intentId: claim!.id, stage: "invoice.submit", outcome: "started" } }), 1); assert.equal((await a.current()).stableReference, a.sale.intent.stableReference);
});

test("FISCAL-23 FI-D16 partial commercial parcel cannot issue against a larger original order", async () => {
  const a = await arrangeIssuance(f, { approvedAmountCents: 3000 }); await a.run();
  assert.equal(a.evidence.binding.amountCents, 3000); assert.equal(a.evidence.receipt.amountCents, 3000); assert.equal(a.sale.completedOrder.orderTotal.toNumber(), 30);
  assert.equal(a.sale.snapshot.totalCents, 2101); assert.equal(a.writes().length, 0);
  assert.equal((await a.current()).state, "action_required"); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
});

test("FISCAL-24 foreign queued issuance stays actionable without provider IO or stock reassignment", async () => {
  const a = await arrangeIssuance(f, { orderMerchantId: f.tag + "_legacy_host", stockOwner: "provider" });
  await a.run();
  assert.equal((await a.current()).state, "action_required"); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  assert.equal(a.calls.length, 0); assert.equal(await f.prisma.fiscalIssuanceRevision.count({ where: { intentId: a.sale.intent.id } }), 0);
  assert.equal((await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: a.sale.connection.id } })).stockOwner, "provider");
  assert.equal(await f.prisma.fiscalEvent.count({ where: { intentId: a.sale.intent.id, action: "stock_barrier_released" } }), 0);
});
test("FISCAL-24 a frozen foreign revision cannot bypass scope through the real worker", async () => {
  const a = await arrangeIssuance(f, { orderMerchantId: f.tag + "_frozen_host" });
  const payload = await seedHistoricalFiscalIssuance(f, a, { transmitted: false });
  a.payments.read = async () => { throw new Error("frozen evidence must not requery PSP"); };
  const worker = new FiscalWorker(f.prisma, a.service, a.service, new PrismaFiscalStockCoordinator(f.prisma));
  assert.equal(await worker.runOnce(a.scope, a.sale.intent.id), true);
  assert.equal((await a.current()).state, "action_required"); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  assert.equal(a.calls.length, 0);
  assert.deepEqual((await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({ where: { intentId: a.sale.intent.id } })).payload, payload);
});
test("FISCAL-24 own-store frozen evidence resumes without querying PSP or mutable payment setup again", async () => {
  const a = await arrangeIssuance(f); const payload = await seedHistoricalFiscalIssuance(f, a, { transmitted: false });
  a.payments.read = async () => { throw new Error("frozen evidence must not requery PSP"); };
  await a.run(); assert.equal(a.writes().length, 1);
  const { __zyonFiscalDelivery, ...wirePayload } = payload; assert.ok(__zyonFiscalDelivery);
  assert.deepEqual(a.writes()[0]!.body, wirePayload);
  assert.deepEqual((await f.prisma.fiscalIssuanceRevision.findFirstOrThrow({ where: { intentId: a.sale.intent.id } })).payload, payload);
  assert.equal((await a.current()).state, "processing");
});
test("FISCAL-24 own-store identity cannot hide another persisted seller in the same original order", async () => {
  const a = await arrangeIssuance(f);
  const other = await seedFiscalSale(f, { orderMerchantId: a.sale.merchantId, orderId: a.sale.orderId, issuance: true });
  const historical = await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: other.snapshot.id } });
  await a.run(); assert.equal(a.calls.length, 0); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  assert.deepEqual(await f.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: other.snapshot.id } }), historical);
});
test("FISCAL-24 an omitted zero-value commercial line blocks legacy own-parcel promotion and issuance", async () => {
  const a = await arrangeIssuance(f, { orderLineItems: [
    { lineId: "line_a", sku: "shirt", quantity: 2, unitPriceCents: 1000, productType: "physical" },
    { lineId: "foreign_free", sku: "foreign_free", quantity: 1, unitPriceCents: 0, productType: "physical" },
  ] });
  const policy = await f.prisma.$transaction(tx => new PrismaFiscalOrderParticipant(tx, "homologation", new TenantContextService(), { find: () => null }).record({
    order: { merchantId: a.sale.merchantId, sessionId: a.sale.completedOrder.sessionId, externalOrderId: a.sale.orderId } as never,
    session: { merchantId: a.sale.merchantId, sessionId: a.sale.completedOrder.sessionId } as never,
  }));
  assert.deepEqual(policy.sellers, []);
  await a.run(); assert.equal(a.calls.length, 0); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  const order = await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: a.sale.completedOrder.id } });
  assert.equal(order.orderTotal.toNumber(), 21.01); assert.equal((order.lineItemsJson as any[]).length, 2);
  assert.equal(a.sale.snapshot.totalCents, 2101);
});
test("FISCAL-23 the existing buyer service fee does not become goods value or cross-store allocation", async () => {
  const a = await arrangeIssuance(f, { approvedAmountCents: 3000, orderTotalCents: 2101 });
  await f.prisma.paymentIntent.create({ data: { id: a.sale.snapshot.paymentProofRef!, merchantId: a.sale.merchantId,
    sessionId: a.sale.completedOrder.sessionId, idempotencyKey: crypto.randomUUID(), status: "approved", method: "card", currency: "BRL", amountCents: 3000, approvedAmountCents: 3000,
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 2000, discountCents: 101, shippingCents: 202, platformFeeCents: 899, totalCents: 3000 } } });
  await a.run(); assert.equal(a.writes().length, 1); assert.equal(a.writes()[0]!.body!.valor_total, 21.01);
  assert.equal(a.writes()[0]!.body!.formas_pagamento[0].valor_pagamento, 21.01);
  assert.equal(a.evidence.receipt.amountCents, 3000); assert.equal(a.sale.completedOrder.orderTotal.toNumber(), 21.01);
});


test("FISCAL-24 canonical scope also fences direct journal admission and corrected reprocess", async () => {
  const a = await arrangeIssuance(f, { orderMerchantId: f.tag + "_legacy_reprocess" });
  await seedHistoricalFiscalIssuance(f, a);
  a.setRemote("rejected");
  const { FiscalReconciliationService } = await import("./fiscal-reconciliation.service.js");
  await new FiscalReconciliationService(a.store, a.factory, { read: async () => ({ found: false, reasonCode: "none" }) }, new PrismaFiscalStockCoordinator(f.prisma)).reconcile(a.scope, a.sale.intent.id);
  assert.equal((await a.current()).state, "rejected");
  await assert.rejects(a.service.reprocess(a.scope, a.sale.intent.id, a.sale.profile.id, { actorKind: "merchant", actorId: "owner", permission: "fiscal.reprocess" }), /fiscal_order_scope_unsupported/);
  const before = await a.current();
  assert.equal(before.issuanceRevision, 1); assert.equal(a.writes().length, 0);
  const direct = await arrangeIssuance(f, { orderLineItems: [{ lineId: "line_a", sku: "shirt", quantity: 2, unitPriceCents: 1000, productType: "physical" }, { lineId: "zero", sku: "zero", quantity: 1, unitPriceCents: 0, productType: "physical" }] });
  const session = await direct.store.open((await direct.claim())!);
  assert.equal(await session.journal.check(session.context.identity, "invoice.submit"), false);
  assert.equal(await session.journal.begin({ identity: session.context.identity, stage: "invoice.submit", reference: session.context.identity.reference, payloadHash: "a".repeat(64), outcome: "started" }), false);
  assert.equal(await f.prisma.fiscalProviderStageReceipt.count({ where: { intentId: direct.sale.intent.id } }), 0);
});


test("FISCAL-24 unsupported pending configuration cannot re-admit or reconnect a new issuance", async () => {
  const a = await arrangeIssuance(f, { orderMerchantId: f.tag + "_pending_legacy" });
  const { FiscalPendingConfigurationService } = await import("./fiscal-pending-configuration.service.js");
  const pending = new FiscalPendingConfigurationService(f.prisma, { readiness: () => ({ ready: true }) } as never, new TenantContextService());
  const actor = { actorKind: "merchant", actorId: "owner" };
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { state: "action_required", lastErrorCode: "fiscal_profile_unconfirmed" } });
  await assert.rejects(pending.admit(a.scope, a.sale.intent.id, a.sale.profile.id, actor), /fiscal_first_issuance_not_allowed/);
  assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  await pending.confirmed(a.sale.profile as never, actor);
  assert.equal((await a.current()).state, "action_required");
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { lastErrorCode: "fiscal_reauthorization_required" } });
  await pending.configuredConnection(a.scope, a.sale.connection.id, actor);
  assert.equal((await a.current()).state, "action_required"); assert.equal((await a.current()).lastErrorCode, "fiscal_order_scope_unsupported");
  assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: a.sale.merchantId, producer: "fiscal" } }), 0);
  assert.equal(a.calls.length, 0);
});
