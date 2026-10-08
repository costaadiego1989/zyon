import 'reflect-metadata';
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ReturnReverseShippingService } from "./return-reverse-shipping.service.js";
import { buildMarketplaceShipmentRequest, carrierQuoteSnapshot } from "../../shipping/domain/marketplace-shipment-journal.js";
import { marketplaceShippingContractHash as hash } from "../../shipping/domain/marketplace-shipping-contract.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";

const parcel = { height: 12, width: 16, length: 24, weight: 2 };
function original(origin: string, line: string, variant: string, unit: number) {
  const identity = { version: 1 as const, provider: "melhor-envio" as const, environment: "test" as const, originMerchantId: origin, providerUserId: randomUUID() };
  const contract = { version: 2 as const, merchantId: origin, originZip: "01001000", destinationZip: "30130010", insuranceTotalCents: unit * 2,
    products: [{ lineItemId: line, variantId: variant, sku: line, unitValueCents: unit, quantity: 2, weightKg: 1, widthCm: 16, heightCm: 12, lengthCm: 24 }] };
  const quote = carrierQuoteSnapshot({ packages: [{ dimensions: parcel, weight: "2.00", insurance_value: unit * 2 / 100, products: [{ id: line, quantity: 2 }] }],
    environment: "test", accountFingerprint: hash(identity), accountIdentity: identity, serviceId: 1, amountCents: 1999, products: [{ id: line, unitValueCents: unit, quantity: 2 }] })!;
  const address = (zip: string) => ({ name: "Fixture", phone: "11999999999", email: "buyer@example.test", document: "00000000000", state_register: "ISENTO",
    address: "Rua Teste", number: "10", district: "Centro", city: "São Paulo", state_abbr: "SP", postal_code: zip, country_id: "BR" as const });
  const request = buildMarketplaceShipmentRequest({ hostMerchantId: "host", paymentIntentId: "payment", originMerchantId: origin, quoteId: `quote_${origin}`,
    quoteKey: `marketplace-v2:${"a".repeat(64)}:${hash(contract)}`, carrierQuoteHash: hash(quote), contract, carrierQuote: quote,
    from: address(contract.originZip), to: address(contract.destinationZip), invoiceKey: "1".repeat(44), productNames: { [line]: "Product" } });
  const carrierOrderId = randomUUID(), carrierPurchaseId = randomUUID();
  const purchase = { version: 1, carrierOrderId, carrierPurchaseId, amountCents: 1999, currency: "BRL", paidAt: "2026-10-07 12:00:00", requestHash: hash(request), transactions: [{ id: randomUUID(), amountCents: 1999 }] };
  const generation = { version: 1, carrierOrderId, requestHash: hash(request), purchaseReceiptHash: hash(purchase), paidAt: purchase.paidAt, generatedAt: "2026-10-07 12:01:00", trackingCode: "AB123456789BR" };
  return { id: `journal_${origin}`, hostMerchantId: "host", fundingPlanId: "payment", originMerchantId: origin, volumeIndex: 0, quoteId: request.quoteId,
    quoteKey: request.quoteKey, environment: request.environment, accountFingerprint: request.accountFingerprint, reference: request.reference,
    request, requestHash: hash(request), status: "generated", carrierOrderId, carrierPurchaseId, purchaseReceipt: purchase, purchaseReceiptHash: hash(purchase),
    purchasedAt: new Date(), generationReceipt: generation, generationReceiptHash: hash(generation), generatedAt: new Date(), cancellationStatus: null };
}
function fixture() {
  const originals = [original("seller_a", "line_a", "variant_a", 1000), original("seller_b", "line_b", "variant_b", 2000)];
  const ret: any = { id: "return", merchantId: "host", orderId: "commerce_order", status: "REQUESTED", label: null,
    items: [{ variantId: "variant_a", quantity: 1 }, { variantId: "variant_b", quantity: 2 }] };
  const instructions = { lines: [ { lineItemId: "line_a", sellerMerchantId: "seller_a", grossAmountCents: 2000 },
    { lineItemId: "line_b", sellerMerchantId: "seller_b", grossAmountCents: 4000 } ] };
  const plan: any = { paymentIntentId: "payment", providerPaymentId: "native_payment", instructions, instructionsHash: fundingHash(instructions) };
  const events = new Map<string, any>(), parcels = new Map(), native = new Map<string, { paid: boolean; code: string | null }>();
  const calls: any[] = [];
  const matches = (row: any, where: any) => (!where?.id || (typeof where.id === "string" ? row.id === where.id :
    (!where.id.in || where.id.in.includes(row.id)) && (!where.id.startsWith || row.id.startsWith(where.id.startsWith)))) &&
    (!where?.merchantId || row.merchantId === where.merchantId) && (!where?.status || row.status === where.status) &&
    (!where?.carrierRaw || row.carrierRaw.returnId === where.carrierRaw.equals);
  const trackingEvent = {
    findMany: async ({ where }: any) => [...events.values()].filter(row => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)),
    findUniqueOrThrow: async ({ where }: any) => structuredClone(events.get(where.id)),
    count: async ({ where }: any) => [...events.values()].filter(row => matches(row, where)).length,
    create: async ({ data }: any) => { events.set(data.id, { ...data, createdAt: new Date() }); return data; },
    update: async ({ where, data }: any) => { Object.assign(events.get(where.id), data); return events.get(where.id); },
    updateMany: async ({ where, data }: any) => { let count = 0; for (const row of events.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; },
  };
  const prisma: any = { trackingEvent, $queryRaw: async () => [], $transaction: async (fn: any) => fn(prisma),
    return: { findFirst: async ({ where }: any) => where.merchantId === "host" && (!where.status || where.status === ret.status) ? structuredClone(ret) : null,
      updateMany: async ({ where, data }: any) => { if (where.status !== ret.status) return { count: 0 }; Object.assign(ret, data); return { count: 1 }; } },
    completedOrder: { findMany: async () => [{ externalOrderId: "commerce_order", sessionId: "session", lineItemsJson: [
      { variantId: "variant_a", name: "Produto A", quantity: 2, unitPriceCents: 1000 }, { variantId: "variant_b", name: "Produto B", quantity: 2, unitPriceCents: 2000 } ] }] },
    paymentIntent: { findMany: async () => [{ currency: "BRL", marketplaceFunding: plan }] },
    crossStoreLineItem: { findMany: async () => [{ id: "line_a", sourceVariantId: "variant_a", sellerMerchantId: "seller_a", quantity: 2, unitPriceCents: 1000 },
      { id: "line_b", sourceVariantId: "variant_b", sellerMerchantId: "seller_b", quantity: 2, unitPriceCents: 2000 }] },
    marketplaceShipmentJournal: { findMany: async ({ where }: any) => originals.filter(row => row.originMerchantId === where.originMerchantId) },
    merchant: { findUnique: async ({ where }: any) => ({ name: where.id === "seller_a" ? "Loja A" : "Loja B" }) },
    shipment: { create: async ({ data }: any) => { parcels.set(data.id, data); }, update: async () => ({}) },
    returnLabel: { create: async ({ data }: any) => { ret.label = data; } },
  };
  const carrier: any = {
    original: async (source: any) => { calls.push(["original", source]); return { package: parcel, email: "buyer@example.test", phone: "11999999999" }; },
    prepareRequest: async (source: any, input: any) => ({ ...source, body: { service: input.serviceId, package: input.package }, from: {}, to: {} }),
    create: async (request: any) => { calls.push(["cart", request.originMerchantId]); native.set(request.originMerchantId, { paid: false, code: null }); return randomUUID(); },
    read: async (request: any) => { const state = native.get(request.originMerchantId)!;
      return { amountCents: 1999, paid: state.paid, code: state.code, generatedAt: state.code ? "2026-10-07 12:03:00" : null, purchasable: !state.paid }; },
    checkout: async (request: any) => { calls.push(["checkout", request.originMerchantId]); native.get(request.originMerchantId)!.paid = true; },
    generate: async (request: any) => { calls.push(["generate", request.originMerchantId]); native.get(request.originMerchantId)!.code = request.originMerchantId === "seller_a" ? "1234567890" : "9876543210"; },
  };
  const service = new ReturnReverseShippingService(prisma, carrier);
  return { service, calls, ret, plan, originals };
}
test("marketplace reverse uses both original seller accounts and stores each destination's native posting code", async () => {
  const f = fixture(), view = await f.service.candidates("host", "return"); assert.equal(view.candidates.length, 2);
  const sources = f.calls.filter(c => c[0] === "original").map(c => c[1]);
  assert.deepEqual(sources.map(s => [s.originMerchantId, s.insuranceCents]), [["seller_a", 1000], ["seller_b", 4000]]);
  assert.ok(sources.every(s => s.accountIdentity.originMerchantId === s.originMerchantId && s.originalOrderId === f.originals.find(o => o.originMerchantId === s.originMerchantId)!.carrierOrderId));
  await f.service.prepare("host", "return", { serviceId: 1, packages: view.candidates.map(c => ({ originMerchantId: c.originMerchantId, package: parcel })) });
  assert.equal(f.calls.filter(c => c[0] === "checkout").length, 0);
  const result = await f.service.confirm("host", "return", 3998);
  assert.deepEqual(result.shipments.map(s => s.postingCode).sort(), ["1234567890", "9876543210"]);
  assert.equal(f.ret.status, "LABEL_GENERATED"); assert.match(f.ret.label.trackingNumber, /Loja A: 1234567890/); assert.match(f.ret.label.trackingNumber, /Loja B: 9876543210/);
  assert.deepEqual(f.calls.filter(c => c[0] === "checkout").map(c => c[1]).sort(), ["seller_a", "seller_b"]);
});
test("a return cannot send another seller's variant or use a changed original shipment", async () => {
  const f = fixture(); f.ret.items[0].variantId = "foreign_variant";
  await assert.rejects(f.service.candidates("host", "return"), /items_unproven/); assert.equal(f.calls.length, 0);
  const g = fixture(); g.originals[1].requestHash = "0".repeat(64);
  await assert.rejects(g.service.candidates("host", "return"), /journal_invalid/); assert.equal(g.calls.length, 0);
});
test("changed funding identity fails before any carrier request", async () => {
  const f = fixture(); f.plan.instructionsHash = "0".repeat(64);
  await assert.rejects(f.service.candidates("host", "return"), /original_order_unproven/); assert.equal(f.calls.length, 0);
});
