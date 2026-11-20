import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHmac } from "node:crypto";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { FISCAL_WEBHOOK_DISPATCH } from "../../../shared/integrations/fiscal-webhook-dispatch.port.js";
import { FiscalWebhookDispatcher } from "../infrastructure/fiscal-webhook.dispatcher.js";
import { FiscalWebhooksController } from "./fiscal-webhooks.controller.js";
import { MarketplaceWebhookController } from "../../inventory/presentation/http/marketplace-webhook.controller.js";
import { ErpSyncService } from "../../inventory/application/services/erp-sync.service.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>; let dispatcher: FiscalWebhookDispatcher; let reconcile: FiscalReconciliationService;
const config = new Map<string, { secret: string; headerName: string }>(); const oldSecret = process.env.BLING_CLIENT_SECRET;
before(async () => {
  process.env.BLING_CLIENT_SECRET = "synthetic_bling_app_secret";
  f = await createFiscalFixture({ rawBody: true, controllers: [FiscalWebhooksController, MarketplaceWebhookController], providers: [
    { provide: ErpSyncService, useValue: { enqueueWebhookFull: async () => ({ id: "existing_inventory_job" }) } },
    { provide: FISCAL_WEBHOOK_DISPATCH, inject: [PRISMA_CLIENT], useFactory: (db: any) => { dispatcher = new FiscalWebhookDispatcher(db, { read: async connection => config.get(connection.id) ?? null }, { reconcile: (scope, id) => reconcile.reconcile(scope, id) }); return dispatcher; } },
  ] });
}, { timeout: 120000 });
after(async () => { await f?.close(); if (oldSecret === undefined) delete process.env.BLING_CLIENT_SECRET; else process.env.BLING_CLIENT_SECRET = oldSecret; });
async function focus() { const a = await arrangeIssuance(f); await a.run(); a.setRemote("authorized"); config.set(a.sale.connection.id, { secret: "focus_hook_" + a.sale.connection.id, headerName: "x-focus-hook" }); reconcile = new FiscalReconciliationService(a.store, a.factory, { read: async () => ({ found: false, reasonCode: "fiscal_stock_evidence_pending" }) }, new PrismaFiscalStockCoordinator(f.prisma)); return a; }
const callback = (a: Awaited<ReturnType<typeof focus>>, patch: Record<string, unknown> = {}) => ({ ref: a.sale.intent.stableReference, cnpj_emitente: a.sale.connection.issuerTaxId, status: "autorizado", ...patch });
const postFocus = (a: Awaited<ReturnType<typeof focus>>, body = callback(a), token = "focus_hook_" + a.sale.connection.id, node = f.first.url) => fetch(node + "/v1/webhooks/fiscal/focus/" + a.sale.connection.id, { method: "POST", headers: { "content-type": "application/json", "x-focus-hook": token }, body: JSON.stringify(body) });
const requests = (merchantId: string) => f.prisma.outboxMessage.findMany({ where: { merchantId, eventType: "fiscal.reconciliation.requested" } });
test("FISCAL-37 Focus wrong configured header refuses callback with no fiscal mutation or queue", async () => { const a = await focus(); const response = await postFocus(a, callback(a), "wrong_hook"); assert.equal(response.status, 401); assert.equal((await requests(a.sale.merchantId)).length, 0); assert.equal((await a.current()).state, "processing"); });
test("FISCAL-38 Focus callback another issuer, reference or environment cannot cross the original connection", async () => {
  const a = await focus(); for (const patch of [{ cnpj_emitente: "12345678000195" }, { ref: "other_sale" }, { ambiente: "1" }]) assert.equal((await postFocus(a, callback(a, patch))).status, 400);
  assert.equal((await requests(a.sale.merchantId)).length, 0); assert.equal((await a.current()).state, "processing");
});
test("FISCAL-37 configured Focus callback persists a minimal original-scope request then actual authenticated query authorizes", async () => {
  const a = await focus(); const before = a.calls.length; const response = await postFocus(a); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: true }); assert.equal(a.calls.length, before);
  const rows = await requests(a.sale.merchantId); assert.equal(rows.length, 1); assert.deepEqual(rows[0]!.payload, { intentId: a.sale.intent.id, environment: a.scope.environment, connectionId: a.sale.connection.id, provider: "focus", stableReference: a.sale.intent.stableReference });
  await dispatcher.consume(a.sale.merchantId, rows[0]!.payload); assert.equal((await a.current()).state, "authorized"); assert.equal((await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } })).authorizationProtocol, "151260029467289"); assert.equal(a.writes().length, 1);
});
test("FISCAL-38 tenant IDs from authenticated callback body never choose the persisted merchant", async () => { const a = await focus(); assert.equal((await postFocus(a, callback(a, { merchantId: "foreign", tenantId: "foreign", connectionId: "foreign" }))).status, 200); const rows = await requests(a.sale.merchantId); assert.equal(rows.length, 1); assert.equal(rows[0]!.merchantId, a.sale.merchantId); assert.equal((rows[0]!.payload as any).connectionId, a.sale.connection.id); assert.equal((await requests("foreign")).length, 0); });
test("FISCAL-39 replay on two actual HTTP nodes deduplicates one durable request", async () => { const a = await focus(); const responses = await Promise.all([postFocus(a), postFocus(a, callback(a), undefined, f.second.url)]); assert.deepEqual(responses.map(r => r.status), [200, 200]); assert.equal((await requests(a.sale.merchantId)).length, 1); assert.equal(a.writes().length, 1); });
test("FISCAL-39 concurrent replay bursts acknowledge one original durable event on both HTTP nodes", async () => {
  for (let round = 0; round < 8; round++) {
    const a = await focus();
    const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => postFocus(a, callback(a), undefined, index % 2 ? f.first.url : f.second.url)));
    assert.deepEqual(responses.map(response => response.status), Array(24).fill(200), "replay round " + round);
    const rows = await requests(a.sale.merchantId);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]!.payload, { intentId: a.sale.intent.id, environment: a.scope.environment, connectionId: a.sale.connection.id, provider: "focus", stableReference: a.sale.intent.stableReference });
    assert.equal((await a.current()).state, "processing");
    assert.equal(a.writes().length, 1);
  }
});
test("FISCAL-39 old processing callback can only schedule original authenticated query and cannot regress authorization", async () => { const a = await focus(); await reconcile.reconcile(a.scope, a.sale.intent.id); assert.equal((await postFocus(a, callback(a, { status: "processando_autorizacao" }))).status, 200); const row = (await requests(a.sale.merchantId))[0]!; await dispatcher.consume(a.sale.merchantId, row.payload); assert.equal((await a.current()).state, "authorized"); assert.equal(a.writes().length, 1); });
test("FISCAL-40 callback outbox persistence failure returns503 and a retry can persist the original request", async () => {
  const a = await focus(); await f.sql.query(`CREATE FUNCTION fail_hook_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id = '${a.sale.merchantId}' AND NEW.event_type = 'fiscal.reconciliation.requested' THEN RAISE EXCEPTION 'synthetic write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_hook_insert BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_hook_insert()`);
  const response = await postFocus(a); assert.equal(response.status, 503); assert.equal((await requests(a.sale.merchantId)).length, 0); await f.sql.query("DROP TRIGGER fail_hook_insert ON outbox_messages; DROP FUNCTION fail_hook_insert()"); assert.equal((await postFocus(a)).status, 200); assert.equal((await requests(a.sale.merchantId)).length, 1);
});
async function bling() { const a = await seedFiscalSale(f, { provider: "bling" }); const erp = await f.prisma.erpConnection.create({ data: { merchantId: a.merchantId, provider: "bling", status: "connected" } }); await f.prisma.fiscalConnection.update({ where: { id: a.connection.id }, data: { erpConnectionId: erp.id } }); await f.prisma.fiscalIntent.update({ where: { id: a.intent.id }, data: { remoteInvoiceId: "501" } }); const account = a.intent.id + "_account"; await f.prisma.erpWebhookRoute.create({ data: { merchantId: a.merchantId, connectionId: erp.id, provider: "bling", externalAccountId: account } }); return { ...a, account }; }
async function postBling(body: unknown, signature?: string) { const raw = JSON.stringify(body); return fetch(f.first.url + "/v1/inventory/erp/webhook/bling", { method: "POST", headers: { "content-type": "application/json", "x-bling-signature-256": signature ?? "sha256=" + createHmac("sha256", process.env.BLING_CLIENT_SECRET!).update(raw).digest("hex") }, body: raw }); }
test("FISCAL-37 ACTUAL configured Bling inventory receiver authenticates and routes invoice events to fiscal outbox", async () => { const a = await bling(); const response = await postBling({ eventId: "event_original", companyId: a.account, event: "invoice.updated", data: { id: 501 } }); assert.equal(response.status, 200); const row = (await requests(a.merchantId))[0]!; assert.equal((row.payload as any).intentId, a.intent.id); assert.equal((row.payload as any).connectionId, a.connection.id); assert.equal(row.merchantId, a.merchantId); });
test("FISCAL-37 ACTUAL Bling receiver rejects wrong raw HMAC without any fiscal enqueue", async () => { const a = await bling(); assert.equal((await postBling({ eventId: "event_original", companyId: a.account, event: "invoice.updated", data: { id: 501 } }, "sha256=" + "0".repeat(64))).status, 401); assert.equal((await requests(a.merchantId)).length, 0); });
test("FISCAL-38 Bling trusted account route cannot apply another account's fiscal document", async () => { const a = await bling(); const other = await bling(); assert.equal((await postBling({ eventId: "event_foreign", companyId: a.account, event: "invoice.updated", data: { id: "foreign_invoice" }, merchantId: other.merchantId })).status, 200); assert.equal((await requests(a.merchantId)).length, 0); assert.equal((await requests(other.merchantId)).length, 0); });
test("FISCAL-40 query-only providers cannot authenticate an invented webhook and enqueue fiscal work", async () => { const a = await focus(); for (const provider of ["omie", "tiny"]) { const response = await fetch(f.first.url + "/v1/webhooks/fiscal/" + provider + "/" + a.sale.connection.id, { method: "POST", headers: { "content-type": "application/json", authorization: "invented_signature" }, body: JSON.stringify(callback(a)) }); assert.equal(response.status, 401); } assert.equal((await requests(a.sale.merchantId)).length, 0); });

test("FISCAL-40 downstream authorization persistence failure keeps the committed callback retryable", async () => {
  const a = await focus(); assert.equal((await postFocus(a)).status, 200); const row = (await requests(a.sale.merchantId))[0]!;
  await f.sql.query(`CREATE FUNCTION fail_hook_auth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.intent_id = '${a.sale.intent.id}' AND NEW.state = 'authorized' THEN RAISE EXCEPTION 'synthetic auth failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_hook_auth BEFORE UPDATE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION fail_hook_auth()`);
  await assert.rejects(dispatcher.consume(a.sale.merchantId, row.payload), /fiscal_webhook_reconciliation_pending/); assert.equal((await requests(a.sale.merchantId)).length, 1); assert.equal((await a.current()).state, "reconciliation_required");
  await f.sql.query("DROP TRIGGER fail_hook_auth ON fiscal_documents; DROP FUNCTION fail_hook_auth()"); await dispatcher.consume(a.sale.merchantId, row.payload); assert.equal((await a.current()).state, "authorized"); assert.equal(a.writes().length, 1);
});
test("FISCAL-38 ACTUAL Bling account route ignores hostile tenant fields for a matching original invoice", async () => {
  const a = await bling(), other = await bling(); assert.equal((await postBling({ eventId: "event_scoped", companyId: a.account, event: "invoice.updated", data: { id: 501 }, merchantId: other.merchantId, environment: "production" })).status, 200);
  assert.equal((await requests(a.merchantId)).length, 1); assert.equal((await requests(other.merchantId)).length, 0); assert.equal(((await requests(a.merchantId))[0]!.payload as any).intentId, a.intent.id);
});
