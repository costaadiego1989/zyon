import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalSaleSnapshotService } from "./fiscal-sale-snapshot.service.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalSnapshotRepository } from "../infrastructure/prisma-fiscal-snapshot.repository.js";
import type { FiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { fixture = await createFiscalFixture(); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange() {
  const sale = await seedFiscalSale(fixture);
  await fixture.prisma.fiscalIntent.delete({ where: { id: sale.intent.id } });
  await fixture.prisma.fiscalSaleSnapshot.delete({ where: { id: sale.snapshot.id } });
  const profiles = new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => ({ operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional"], productTypes: ["physical", "food"] }) });
  const profile = { ...sale.profile, itemRules: { currency: "BRL", supportedProductTypes: ["physical"], items: { sku_a: {
    productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { csosn: "102" },
  } } } };
  const store = new PrismaFiscalSnapshotRepository(fixture.prisma);
  const service = new FiscalSaleSnapshotService(store, profiles);
  const input = { orderMerchantId: sale.orderMerchantId, completedOrderId: sale.completedOrder.id, orderId: sale.orderId,
    completedAt: sale.completedOrder.completedAt, sessionId: sale.completedOrder.sessionId, buyerGlobalUserId: "buyer", currency: "BRL",
    recipient: { name: "Synthetic Buyer", taxId: "52998224725" }, lines: [{ lineId: "a", sellerMerchantId: sale.merchantId, sku: "sku_a", productType: "physical" as const, quantity: 1, unitPriceCents: 1000 }],
    discountCents: 1, shippingCents: 1, totalCents: 1000, paymentProofRef: null };
  const contexts = [{ merchantId: sale.merchantId, environment: sale.environment, connection: sale.connection, profile }];
  return { sale, service, store, input, contexts };
}
test("FISCAL-23 snapshot preserves original commercial quantity price recipient timestamp and hash after source edits", async () => {
  const { service, input, contexts } = await arrange();
  const [first] = await service.capture(input, contexts);
  input.lines[0].unitPriceCents = 999999; input.recipient.name = "Changed"; input.completedAt = new Date();
  const [repeated] = await service.capture(input, contexts);
  assert.equal(repeated.id, first.id); assert.equal(repeated.contentHash, first.contentHash);
  assert.equal((repeated.recipient as { name: string }).name, "Synthetic Buyer");
  const envelope = repeated.items as FiscalSnapshotEnvelope;
  assert.equal(envelope.commercialLines[0].unitPriceCents, 1000); assert.equal(envelope.commercialLines[0].quantity, 1);
  assert.equal(repeated.completedAt.toISOString(), first.completedAt.toISOString());
});
test("FISCAL-24 FI-D16 cross-store lines and contexts create no fiscal snapshots", async () => {
  const { sale, service, input, contexts } = await arrange();
  const other = await seedFiscalSale(fixture, { orderMerchantId: sale.orderMerchantId, orderId: sale.orderId });
  await fixture.prisma.fiscalIntent.delete({ where: { id: other.intent.id } }); await fixture.prisma.fiscalSaleSnapshot.delete({ where: { id: other.snapshot.id } });
  input.lines.push({ ...input.lines[0], lineId: "b", sellerMerchantId: other.merchantId }); input.totalCents = 2000;
  contexts.push({ ...contexts[0], merchantId: other.merchantId, connection: other.connection, profile: { ...contexts[0].profile, merchantId: other.merchantId, id: other.profile.id } });
  const snapshots = await service.capture(input, contexts);
  assert.deepEqual(snapshots, []);
  assert.equal(input.totalCents, 2000);
  assert.equal(input.lines.reduce((sum, row) => sum + row.quantity * row.unitPriceCents, 0), 2000);
  assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { orderId: sale.orderId } }), 0);
  assert.equal((await fixture.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: sale.connection.id } })).merchantId, sale.merchantId);
});
test("FISCAL-24 an existing foreign snapshot cannot bypass capture scope through idempotency", async () => {
  const { service, input, contexts, sale } = await arrange();
  const legacy = await seedFiscalSale(fixture, { orderMerchantId: sale.orderMerchantId, orderId: sale.orderId, issuance: true });
  const original = await fixture.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: legacy.snapshot.id } });
  assert.deepEqual(await service.capture(input, [{ ...contexts[0], merchantId: legacy.merchantId, connection: legacy.connection }]), []);
  assert.deepEqual(await fixture.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: legacy.snapshot.id } }), original);
  assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { merchantId: sale.merchantId, orderId: sale.orderId } }), 0);
});
test("FISCAL-25 indivisible discounts and freight appear once and close every commercial cent", async () => {
  const { service, input, contexts } = await arrange();
  input.lines.push({ ...input.lines[0], lineId: "b" }); input.totalCents = 2000;
  const [snapshot] = await service.capture(input, contexts);
  const envelope = snapshot.items as FiscalSnapshotEnvelope;
  assert.deepEqual(envelope.commercialLines.map(line => [line.discountCents, line.shippingCents]), [[1, 1], [0, 0]]);
  assert.equal(snapshot.subtotalCents, 2000); assert.equal(snapshot.discountCents, 1); assert.equal(snapshot.shippingCents, 1); assert.equal(snapshot.totalCents, 2000);
});
test("FISCAL-27 digital service and unvalidated food remain separate from supported goods", async () => {
  const { service, input, contexts } = await arrange();
  for (const productType of ["digital", "service", "food"] as const) input.lines.push({ ...input.lines[0], lineId: productType, productType } as typeof input.lines[number]);
  input.totalCents = 4000;
  const [snapshot] = await service.capture(input, contexts); const envelope = snapshot.items as FiscalSnapshotEnvelope;
  assert.deepEqual(envelope.lines.map(line => line.lineId), ["a"]);
  assert.deepEqual(envelope.excludedLines.map(line => line.productType).sort(), ["digital", "service"]);
  assert.deepEqual(envelope.pendingLines.map(line => line.productType), ["food"]);
  assert.equal(envelope.commercialLines.length, 4); assert.equal(snapshot.totalCents, 4000);
  assert.equal(envelope.readinessCode, "fiscal_operation_unsupported");
});
test("missing profile freezes paid physical freight and raw sale as pending without guessed taxes", async () => {
  const { service, input, contexts } = await arrange();
  const [snapshot] = await service.capture(input, contexts.map(context => ({ ...context, profile: null })));
  const envelope = snapshot.items as FiscalSnapshotEnvelope;
  assert.equal(envelope.readinessCode, "fiscal_profile_unconfirmed"); assert.equal(envelope.lines.length, 0);
  assert.equal(envelope.pendingLines[0].unitPriceCents, 1000); assert.equal(snapshot.shippingCents, 1);
  assert.equal(envelope.profileVersionId, null); assert.equal(JSON.stringify(envelope).includes("csosn"), false);
});
test("unsupported currency remains explicitly pending without reinterpreting cents as BRL", async () => {
  const { service, input, contexts } = await arrange(); input.currency = "USD";
  const [snapshot] = await service.capture(input, contexts);
  assert.equal(snapshot.currency, "USD"); assert.equal(snapshot.totalCents, 1000);
  assert.equal((snapshot.items as FiscalSnapshotEnvelope).readinessCode, "fiscal_operation_unsupported");
});
test("snapshot freezes stock and channel owners for retries after connection policy changes", async () => {
  const { service, input, contexts } = await arrange(); contexts[0].connection.stockOwner = "provider";
  const [snapshot] = await service.capture(input, contexts);
  contexts[0].connection.stockOwner = "zyon"; contexts[0].connection.emailOwner = "provider";
  const [retry] = await service.capture(input, contexts);
  assert.deepEqual((retry.items as FiscalSnapshotEnvelope).policy, { stockOwner: "provider", emailOwner: "zyon", whatsappOwner: "zyon" });
  assert.equal(retry.contentHash, snapshot.contentHash);
});
test("snapshot transaction failure leaves no seller snapshot behind", async () => {
  const { service, input, contexts, sale } = await arrange();
  await fixture.sql.query("CREATE FUNCTION fail_fiscal_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fiscal_capture_storage_failed'; END $$; CREATE TRIGGER fail_fiscal_capture BEFORE INSERT ON fiscal_sale_snapshots FOR EACH ROW EXECUTE FUNCTION fail_fiscal_capture()");
  try { await assert.rejects(service.capture(input, contexts), /fiscal_capture_storage_failed/); }
  finally { await fixture.sql.query("DROP TRIGGER fail_fiscal_capture ON fiscal_sale_snapshots; DROP FUNCTION fail_fiscal_capture()"); }
  assert.equal(await fixture.prisma.fiscalSaleSnapshot.count({ where: { orderId: sale.orderId } }), 0);
});
