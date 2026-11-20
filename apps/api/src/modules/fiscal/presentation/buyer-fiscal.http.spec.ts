import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance, seedHistoricalFiscalIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { fiscalXmlFixture, fiscalPdfFixture } from "../../../../tests/fiscal-artifact-fixtures.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { BuyerJwtAuthGuard } from "../../buyer-account/presentation/http/buyer-jwt-auth.guard.js";
import { FiscalDocumentService } from "../application/fiscal-document.service.js";
import { PrismaFiscalDocumentAccess } from "../infrastructure/prisma-fiscal-document.access.js";
import { FiscalArtifactStore } from "../infrastructure/fiscal-artifact.store.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { BuyerFiscalController, FISCAL_DOCUMENT_SERVICE } from "./buyer-fiscal.controller.js";
let f: Awaited<ReturnType<typeof createFiscalFixture>>; let service: FiscalDocumentService;
const jwt = new BuyerJwtService("synthetic_fiscal_buyer_secret");
before(async () => { f = await createFiscalFixture({ controllers: [BuyerFiscalController], providers: [{ provide: BuyerJwtService, useValue: jwt }, BuyerJwtAuthGuard, { provide: FISCAL_DOCUMENT_SERVICE, useValue: { forOrder: (...args: Parameters<FiscalDocumentService["forOrder"]>) => service.forOrder(...args), download: (...args: Parameters<FiscalDocumentService["download"]>) => service.download(...args) } }] }); }, { timeout: 120000 });
after(async () => { await f?.close(); });
async function ready(options: { pending?: boolean; host?: string } = {}) {
  const a = await arrangeIssuance(f, options.host ? { orderMerchantId: options.host } : {});
  if (options.host) await seedHistoricalFiscalIssuance(f, a); else await a.run();
  if (!options.pending) { a.setRemote("authorized"); await new FiscalReconciliationService(a.store, a.factory, { read: async () => ({ found: false, reasonCode: "none" }) }, new PrismaFiscalStockCoordinator(f.prisma)).reconcile(a.scope, a.sale.intent.id); }
  service = new FiscalDocumentService(new PrismaFiscalDocumentAccess(f.prisma), new FiscalArtifactStore(f.prisma), a.store, a.factory);
  a.setArtifacts({ xml: fiscalXmlFixture(a.sale.connection.issuerTaxId), pdf: await fiscalPdfFixture(true) });
  const token = (buyer = f.tag + "_buyer", merchantId?: string) => jwt.sign({ globalUserId: buyer, email: "same@example.test", merchantId });
  const path = (intent?: string, kind = "xml", host = a.sale.orderMerchantId, order = a.sale.orderId, env = a.scope.environment) => `/v1/buyer/me/orders/${host}/${order}/fiscal${intent ? `/${intent}/documents/${kind}` : ""}?environment=${env}`;
  const get = (pathValue = path(), bearer: string | null = token(), node = f.first.url) => fetch(node + pathValue, { headers: bearer ? { authorization: "Bearer " + bearer } : {} });
  return { ...a, token, path, get };
}
test("FISCAL-41 HTTP own authorized order returns exact persisted note metadata without secrets", async () => { const a = await ready(); const r = await a.get(); assert.equal(r.status, 200); const body = await r.json() as any; assert.equal(body.items[0].number, "22"); assert.equal(body.items[0].authorizationProtocol, "151260029467289"); assert.equal(body.environment, "homologation"); assert.equal(JSON.stringify(body).includes("private_company_token"), false); assert.equal(JSON.stringify(body).includes("privateObjectKey"), false); assert.equal(r.headers.get("cache-control"), "private, no-store"); });
test("FISCAL-44 HTTP owned XML and DANFE use private bytes and never provider credentials", async () => { const a = await ready(); for (const kind of ["xml", "danfe"]) { const r = await a.get(a.path(a.sale.intent.id, kind)); assert.equal(r.status, 200); const bytes = new Uint8Array(await r.arrayBuffer()); assert.ok(bytes.length > 100); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.match(r.headers.get("content-disposition")!, /attachment/); assert.equal(r.headers.get("cache-control"), "private, no-store"); } assert.equal(a.writes().length, 1); });
test("FISCAL-42 HTTP anonymous and bad JWT cannot read metadata or trigger recovery", async () => { const a = await ready(); const n = a.calls.length; for (const bearer of [null, "forged"]) for (const p of [a.path(), a.path(a.sale.intent.id)]) assert.equal((await a.get(p, bearer)).status, 401); assert.equal(a.calls.length, n); });
test("FISCAL-42 HTTP another buyer with same email cannot read identifiers or bytes", async () => { const a = await ready(); const n = a.calls.length; for (const p of [a.path(), a.path(a.sale.intent.id)]) { const r = await a.get(p, a.token("another_buyer")); assert.equal(r.status, 404); assert.equal((await r.text()).includes("151260029467289"), false); } assert.equal(a.calls.length, n); });
test("FISCAL-42 HTTP buyer scoped to another host cannot bypass its JWT merchant binding", async () => { const a = await ready(); const n = a.calls.length; assert.equal((await a.get(a.path(), a.token(undefined, "other_store"))).status, 404); assert.equal((await a.get(a.path(a.sale.intent.id), a.token(undefined, "other_store"))).status, 404); assert.equal(a.calls.length, n); });
test("FISCAL-42 HTTP two stores cannot substitute another owned or foreign order into download", async () => { const a = await ready(); const other = await seedFiscalSale(f, { issuance: true }); const n = a.calls.length; assert.equal((await a.get(a.path(a.sale.intent.id, "xml", other.orderMerchantId, other.orderId))).status, 404); assert.equal((await a.get(a.path(a.sale.intent.id, "xml", "missing_store"))).status, 404); assert.equal(a.calls.length, n); });
test("FISCAL-43 HTTP processing order returns actual state and409 without fabricated files", async () => { const a = await ready({ pending: true }); const body = await (await a.get()).json() as any; assert.equal(body.items[0].state, "processing"); assert.equal(body.items[0].accessKey, undefined); const n = a.calls.length; assert.equal((await a.get(a.path(a.sale.intent.id))).status, 409); assert.equal(a.calls.length, n); });
test("FISCAL-44 HTTP environment and kind are bounded and cannot cross private scope", async () => { const a = await ready(); assert.equal((await a.get(a.path().replace("homologation", "invalid"))).status, 400); assert.equal((await a.get(a.path(a.sale.intent.id, "secret"))).status, 400); assert.equal((await a.get(a.path(a.sale.intent.id, "xml", a.sale.orderMerchantId, a.sale.orderId, "production"))).status, 404); });
test("FISCAL-47 HTTP failed channels and disconnected current account preserve existing private files", async () => { const a = await ready(); await service.recover(a.scope, a.sale.intent.id); await f.prisma.fiscalConnection.update({ where: { id: a.sale.connection.id }, data: { disconnectedAt: new Date() } }); const n = a.calls.length; const r = await a.get(a.path(a.sale.intent.id)); assert.equal(r.status, 200); assert.ok((await r.arrayBuffer()).byteLength > 100); assert.equal(a.calls.length, n); });
test("FISCAL-44 HTTP changed identity is checked again on the second node before each download", async () => { const a = await ready(); assert.equal((await a.get(a.path(a.sale.intent.id))).status, 200); const n = a.calls.length; assert.equal((await a.get(a.path(a.sale.intent.id), a.token("another_buyer"), f.second.url)).status, 404); assert.equal(a.calls.length, n); });
test("FISCAL-41 HTTP archived marketplace host purchase exposes owned legacy invoices without seller purchase rows", async () => { const a = await ready({ host: f.tag + "_commercial_host" }); const second = await arrangeIssuance(f, { orderMerchantId: a.sale.orderMerchantId, orderId: a.sale.orderId }); await seedHistoricalFiscalIssuance(f, second); assert.equal(a.writes().length, 0); assert.equal(second.writes().length, 0); second.setRemote("authorized"); await new FiscalReconciliationService(second.store, second.factory, { read: async () => ({ found: false, reasonCode: "none" }) }, new PrismaFiscalStockCoordinator(f.prisma)).reconcile(second.scope, second.sale.intent.id); second.setArtifacts({ xml: fiscalXmlFixture(second.sale.connection.issuerTaxId), pdf: await fiscalPdfFixture(true) }); await new FiscalDocumentService(new PrismaFiscalDocumentAccess(f.prisma), new FiscalArtifactStore(f.prisma), second.store, second.factory).recover(second.scope, second.sale.intent.id); const token = a.token(undefined, a.sale.orderMerchantId); const r = await a.get(a.path(), token); const body = await r.json() as any; assert.equal(r.status, 200); assert.deepEqual(new Set(body.items.map((n: any) => n.sellerMerchantId)), new Set([a.sale.merchantId, second.sale.merchantId])); assert.notEqual(a.sale.merchantId, a.sale.orderMerchantId); assert.ok(body.items.every((n: any) => n.state === "authorized")); assert.equal((await a.get(a.path(second.sale.intent.id), token)).status, 200); assert.equal((await a.get(a.path(a.sale.intent.id), token)).status, 200); assert.equal(await f.prisma.buyerPurchaseRecord.count({ where: { merchantId: a.sale.merchantId } }), 0); assert.equal((await a.get(a.path(), a.token("foreign", a.sale.orderMerchantId))).status, 404); });
test("FISCAL-44 HTTP artifact persistence failure returns pending without false success or another submit", async () => { const a = await ready(); a.setArtifacts({}); const r = await a.get(a.path(a.sale.intent.id)); assert.equal(r.status, 409); assert.equal((await a.current()).state, "authorized"); assert.equal(a.writes().length, 1); assert.equal(await f.prisma.fiscalArtifact.count({ where: { merchantId: a.sale.merchantId } }), 0); });

test("FISCAL-44 HTTP PostgreSQL artifact insert failure preserves authorization and both nodes recover original XML", async () => {
  const a = await ready();
  const original = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } });
  const expected = Buffer.from(fiscalXmlFixture(a.sale.connection.issuerTaxId));
  const authorization = (row: typeof original) => ({ state: row.state, issuerTaxId: row.issuerTaxId, number: row.number, series: row.series,
    accessKey: row.accessKey, authorizationProtocol: row.authorizationProtocol, authorizedAt: row.authorizedAt });
  assert.equal(original.state, "authorized");
  assert.equal(original.authorizationProtocol, "151260029467289");
  assert.equal(a.writes().length, 1);
  await f.sql.query(`
    CREATE SEQUENCE fiscal_http_artifact_insert_hits;
    CREATE FUNCTION fiscal_http_reject_artifact_insert() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF NEW.merchant_id = TG_ARGV[0] AND NEW.document_id = TG_ARGV[1] AND NEW.kind = 'xml' THEN
        PERFORM nextval(TG_ARGV[2]::regclass);
        RAISE EXCEPTION 'synthetic_fiscal_http_artifact_insert_failure' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $body$;
  `);
  try {
    const trigger = await f.sql.query<{ ddl: string }>(
      "SELECT format('CREATE TRIGGER fiscal_http_artifact_insert_failure BEFORE INSERT ON fiscal_artifacts FOR EACH ROW EXECUTE FUNCTION fiscal_http_reject_artifact_insert(%L, %L, %L)', $1::text, $2::text, $3::text) AS ddl",
      [a.scope.merchantId, original.id, `${f.schema}.fiscal_http_artifact_insert_hits`],
    );
    await f.sql.query(trigger.rows[0]!.ddl);
    const failure = await a.get(a.path(a.sale.intent.id));
    assert.equal(failure.status, 409);
    assert.match(failure.headers.get("content-type")!, /application\/json/);
    const failureBody = await failure.text();
    assert.equal((JSON.parse(failureBody) as { message: string }).message, "fiscal_document_pending");
    assert.equal(failureBody.includes("private_company_token"), false);
    assert.equal(failureBody.includes("<nfeProc"), false);
    // Sequence changes survive the rejected transaction: this witnesses a real SQL INSERT.
    assert.equal((await f.sql.query<{ is_called: boolean }>("SELECT is_called FROM fiscal_http_artifact_insert_hits")).rows[0]!.is_called, true);
    const pending = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: original.id } });
    assert.deepEqual(authorization(pending), authorization(original));
    assert.equal(pending.documentState, "document_pending");
    assert.equal((await a.current()).state, "authorized");
    assert.equal(await f.prisma.fiscalArtifact.count({ where: { documentId: original.id } }), 0);
    assert.equal(a.writes().length, 1);
    const listing = await a.get();
    assert.equal(listing.status, 200);
    const body = await listing.json() as { items: { state: string; authorizationProtocol: string; documents: { kind: string; available: boolean }[] }[] };
    assert.equal(body.items[0]!.state, "authorized");
    assert.equal(body.items[0]!.authorizationProtocol, original.authorizationProtocol);
    assert.equal(body.items[0]!.documents.find(row => row.kind === "xml")!.available, false);

    await f.sql.query("DROP TRIGGER fiscal_http_artifact_insert_failure ON fiscal_artifacts");
    for (const node of [f.first.url, f.second.url]) {
      const response = await a.get(a.path(a.sale.intent.id), a.token(), node);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("content-type")!, /application\/xml/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    }
    const stored = await f.prisma.fiscalArtifact.findMany({ where: { documentId: original.id } });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.kind, "xml");
    assert.deepEqual(Buffer.from(stored[0]!.content), expected);
    assert.equal(stored[0]!.size, expected.length);
    assert.deepEqual(authorization(await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: original.id } })), authorization(original));
    assert.equal((await a.current()).state, "authorized");
    assert.equal(a.writes().length, 1);
  } finally {
    await f.sql.query("DROP TRIGGER IF EXISTS fiscal_http_artifact_insert_failure ON fiscal_artifacts; DROP FUNCTION IF EXISTS fiscal_http_reject_artifact_insert(); DROP SEQUENCE IF EXISTS fiscal_http_artifact_insert_hits");
  }
});
