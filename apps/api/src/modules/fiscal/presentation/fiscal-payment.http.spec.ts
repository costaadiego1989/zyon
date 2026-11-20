import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalCheckoutController } from "./fiscal-checkout.controller.js";
import { FiscalRecipientUpdateService } from "../application/fiscal-recipient-update.service.js";
import { PrismaFiscalRecipientRepository } from "../infrastructure/prisma-fiscal-recipient.repository.js";
import { FiscalBeforePaymentService } from "../application/fiscal-before-payment.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalCheckoutReader } from "../infrastructure/prisma-fiscal-checkout.reader.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let service: FiscalRecipientUpdateService;
const jwt = new BuyerJwtService("fiscal-buyer-local-secret-at-least-32");
const tokens = new EmbedTokenService({ value: Buffer.from("fiscal-embed-local-secret-at-least-32") });
before(async () => {
  fixture = await createFiscalFixture({ controllers: [FiscalCheckoutController], providers: [
    { provide: FiscalRecipientUpdateService, useValue: { update: (...args: Parameters<FiscalRecipientUpdateService["update"]>) => service.update(...args) } },
    { provide: BuyerJwtService, useValue: jwt }, { provide: EmbedTokenService, useValue: tokens }, EmbedAuthGuard,
  ] });
}, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
const recipient = { name: "Empresa Compradora", taxId: "12ABC34501DE35", address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } };
async function arrange() {
  const sale = await seedFiscalSale(fixture);
  const now = Math.floor(Date.now() / 1000);
  const token = tokens.sign({ typ: "aacp_embed_v1", merchantId: sale.merchantId, nonce: sale.orderId,
    issuedAtUnix: now, expiresAtUnix: now + 3600, allowedOrigin: "http://localhost:15174", scopes: ["checkout:track"] });
  const sessionId = embedCheckoutSessionId(tokens.verify(token));
  const buyerId = "buyer_" + sale.intent.id;
  const cart = { currency: "BRL", total: 10, items: [{ sku: "sku_a", price: 10, quantity: 1, productType: "physical" }] };
  await fixture.prisma.checkoutSession.create({ data: { merchantId: sale.merchantId, sessionId, globalUserId: buyerId,
    conversationId: sessionId, createdAt: new Date(), updatedAt: new Date(), cart, customer: { fiscalRecipientMode: "other", fullName: "Comprador", cpf: "52998224725", email: "buyer@example.test" } } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(fixture.prisma, "homologation", new TenantContextService()),
    new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => undefined }));
  const store = new PrismaFiscalRecipientRepository(fixture.prisma);
  service = new FiscalRecipientUpdateService(store, gate);
  const body = { merchant_id: sale.merchantId, session_id: sessionId, recipient };
  const post = (value: unknown = body, buyer = false, buyerToken = jwt.sign({ globalUserId: buyerId, email: "buyer@example.test", merchantId: sale.merchantId })) => fetch(fixture.first.url + (buyer ? "/v1/checkout/customer/fiscal" : "/v1/embed/customer/fiscal"), {
    method: "POST", headers: { "content-type": "application/json", "x-aacp-embed-token": token, origin: "http://localhost:15174", authorization: "Bearer " + buyerToken }, body: JSON.stringify(value),
  });
  const stored = async () => {
    const row = await fixture.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: sale.merchantId, sessionId } } });
    return { ...row, customer: row.customer as Record<string, unknown> | null };
  };
  return { sale, buyerId, sessionId, post, body, cart, stored, store, gate };
}
test("FISCAL-09 HTTP embed preserves alphanumeric CNPJ and personal buyer CPF", async () => {
  const f = await arrange(); const response = await f.post({ ...f.body, recipient: { ...recipient, taxId: "12.abc.345/01de-35" } });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { ok: true, recipient });
  assert.deepEqual((await f.stored()).customer, { fiscalRecipientMode: "other", fullName: "Comprador", cpf: "52998224725", email: "buyer@example.test", fiscalRecipient: recipient });
  assert.deepEqual((await f.stored()).cart, f.cart);
  assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
test("buyer fiscal HTTP route uses persisted ownership for WhatsApp checkout", async () => {
  const f = await arrange(); assert.equal((await f.post(f.body, true)).status, 201);
  assert.deepEqual((await f.stored()).customer?.["fiscalRecipient"], recipient);
  assert.deepEqual((await f.stored()).cart, f.cart);
});
test("incomplete fiscal HTTP data returns correction fields without partial persistence", async () => {
  const f = await arrange(); const original = await f.stored(); const response = await f.post({ ...f.body, recipient: {} });
  assert.equal(response.status, 400); const result = await response.json();
  assert.equal(result.code, "fiscal_customer_data_required"); assert.ok(result.fields.includes("taxId")); assert.ok(result.fields.includes("address.cityCode"));
  assert.deepEqual((await f.stored()).customer, original.customer);
});
test("invalid fiscal HTTP identifier is redacted and keeps the original recipient", async () => {
  const f = await arrange(); const response = await f.post({ ...f.body, recipient: { ...recipient, taxId: "11111111111" } });
  assert.equal(response.status, 400); const result = await response.json(); assert.deepEqual(result.fields, ["taxId"]);
  assert.equal(JSON.stringify(result).includes("11111111111"), false); assert.equal((await f.stored()).customer?.["fiscalRecipient"], undefined);
});
test("unknown fiscal fields cannot change cart prices or verified customer flags", async () => {
  const f = await arrange();
  for (const body of [{ ...f.body, cart: { total: 0 } }, { ...f.body, recipient: { ...recipient, email_verified: true } }, { ...f.body, recipient: { ...recipient, address: { ...recipient.address, secret: "x" } } }]) {
    assert.equal((await f.post(body)).status, 400);
  }
  assert.deepEqual((await f.stored()).cart, f.cart); assert.equal((await f.stored()).customer?.["fiscalRecipient"], undefined);
});
test("a signed embed cannot update another checkout session", async () => {
  const f = await arrange(); assert.equal((await f.post({ ...f.body, session_id: f.sale.completedOrder.sessionId })).status, 401);
  assert.equal((await f.stored()).customer?.["fiscalRecipient"], undefined);
});
test("a buyer token cannot update another buyer or merchant fiscal session", async () => {
  const f = await arrange();
  for (const principal of [{ globalUserId: "other_buyer", email: "other@example.test", merchantId: f.sale.merchantId }, { globalUserId: f.buyerId, email: "buyer@example.test", merchantId: "other_merchant" }]) {
    assert.equal((await f.post(f.body, true, jwt.sign(principal))).status, 401);
  }
  assert.equal((await f.stored()).customer?.["fiscalRecipient"], undefined);
});
test("fiscal recipient persistence failure reports failure and never saves or charges", async () => {
  const f = await arrange(); service = new FiscalRecipientUpdateService({ ...f.store, getSession: f.store.getSession.bind(f.store), saveRecipient: async () => { throw new Error("synthetic_write_failure"); } }, f.gate);
  assert.equal((await f.post()).status, 500); assert.equal((await f.stored()).customer?.["fiscalRecipient"], undefined);
  assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
