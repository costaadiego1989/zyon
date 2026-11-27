import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createOrderHandlers } from "./order.handlers.js";
import type { FiscalDocumentService } from "../../../fiscal/application/fiscal-document.service.js";
const ctx = { merchantId: "host", sessionId: "conversation", buyer: { globalUserId: "trusted_buyer" } };
const note = { intentId: "seller_note", sellerMerchantId: "seller", orderId: "order", state: "authorized", documentState: "available", number: "22", series: "1", accessKey: "real_key", authorizationProtocol: "real_protocol", authorizedAt: "2026-11-15T00:00:00.000Z", documents: [{ kind: "xml" as const, available: true }, { kind: "danfe" as const, available: true }] };
function setup(rows = [note], failure?: string) {
  const calls: unknown[] = []; let stores = 0;
  const documents = { forOrder: async (...args: unknown[]) => { calls.push(args); if (failure) throw new Error(failure); return rows; } } as unknown as Pick<FiscalDocumentService, "forOrder">;
  const prisma = { merchant: { findUnique: async () => { stores++; return { storeSlug: "loja original" }; } } } as unknown as PrismaClient;
  const deps = { prisma, fiscal: { documents, environment: "homologation" as const } };
  return { deps, calls, stores: () => stores, handler: createOrderHandlers(deps, ctx) };
}
test("FISCAL-41 assistant uses trusted buyer and original commercial host for all seller notes", async () => {
  const a = setup([note, { ...note, intentId: "second_note", sellerMerchantId: "second" }]);
  const r = await a.handler.getInvoice({ orderId: " order ", globalUserId: "attacker", merchantId: "other", environment: "production" }) as any;
  assert.deepEqual(a.calls, [[{ kind: "buyer", globalUserId: "trusted_buyer" }, { merchantId: "host", environment: "homologation", orderId: "order" }]]);
  assert.equal(r.invoices.length, 2); assert.equal(r.invoices[0].number, "22"); assert.equal(r.invoices[0].authorizationProtocol, "real_protocol"); assert.equal(r.invoiceAvailable, true);
});
test("FISCAL-41 assistant options navigate to the actual authenticated BuyerHub contract", async () => {
  const r = await setup().handler.getInvoice({ orderId: "order" }) as any;
  assert.deepEqual(r.invoices[0].options, [{ label: "Abrir XML no pedido", action: "navigate", href: "/store/loja%20original?buyerHub=orders&orderId=order&fiscalIntentId=seller_note&fiscalDocument=xml&fiscalEnvironment=homologation" }, { label: "Abrir DANFE no pedido", action: "navigate", href: "/store/loja%20original?buyerHub=orders&orderId=order&fiscalIntentId=seller_note&fiscalDocument=danfe&fiscalEnvironment=homologation" }]);
  assert.equal(r.invoices[0].environment, "homologation"); assert.equal(JSON.stringify(r).includes("Bearer"), false);
});
test("FISCAL-42 assistant denies anonymous before metadata or store IO", async () => {
  const a = setup(); const r = await createOrderHandlers(a.deps, { merchantId: "host", sessionId: "guest" }).getInvoice({ orderId: "order", email: "owner@example.test" }) as any;
  assert.equal(r.requiresIdentification, true); assert.equal(r.invoiceAvailable, false); assert.deepEqual(a.calls, []); assert.equal(a.stores(), 0); assert.equal(r.invoices, undefined);
});
test("FISCAL-42 assistant denies foreign orders without fiscal identifiers or navigation", async () => {
  const a = setup([], "fiscal_document_not_found"); const r = await a.handler.getInvoice({ orderId: "other" }) as any;
  assert.equal(r.invoiceAvailable, false); assert.equal(r.invoices, undefined); assert.equal(r.accessKey, undefined); assert.equal(a.stores(), 0);
});
test("FISCAL-43 assistant preserves processing without fabricated identifiers or files", async () => {
  const a = setup([{ intentId: "pending", sellerMerchantId: "seller", orderId: "order", state: "processing", documentState: "document_pending", documents: [{ kind: "xml", available: false }, { kind: "danfe", available: false }] } as any]);
  const r = await a.handler.getInvoice({ orderId: "order" }) as any;
  assert.equal(r.invoiceAvailable, false); assert.equal(r.invoices[0].state, "processing"); assert.equal(r.invoices[0].number, undefined); assert.equal(r.invoices[0].accessKey, undefined); assert.deepEqual(r.invoices[0].options, []);
});
test("FISCAL-47 assistant retains authorization while both channel and file delivery are pending", async () => {
  const a = setup([{ ...note, documentState: "document_pending", documents: note.documents.map(d => ({ ...d, available: false })) }]);
  const r = await a.handler.getInvoice({ orderId: "order" }) as any;
  assert.equal(r.invoiceAvailable, true); assert.equal(r.invoices[0].authorizationProtocol, "real_protocol"); assert.deepEqual(r.invoices[0].options, []);
});
test("FISCAL-43 assistant handles own order with no eligible fiscal intent", async () => {
  const r = await setup([]).handler.getInvoice({ orderId: "order" }) as any; assert.equal(r.invoiceAvailable, false); assert.deepEqual(r.invoices, []);
});
test("FISCAL-42 assistant does not query without an order or mask a persistence failure", async () => {
  const a = setup([], "database_failure"); assert.equal((await a.handler.getInvoice({}) as any).invoiceAvailable, false); assert.deepEqual(a.calls, []);
  await assert.rejects(a.handler.getInvoice({ orderId: "order" }), /database_failure/);
});
