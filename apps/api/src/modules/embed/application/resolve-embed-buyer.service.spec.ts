import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { InMemoryBuyerAccountRepository } from "../../buyer-account/infrastructure/in-memory-buyer-account.repository.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CheckoutCartAuthorityService } from "../../checkout/application/services/checkout-cart-authority.service.js";
import { createStartCheckoutUseCase } from "../../checkout/application/use-cases/start-checkout.fixture.js";
import { ResolveEmbedBuyerService } from "./resolve-embed-buyer.service.js";
import { EmbedCheckoutController } from "../presentation/http/embed-checkout.controller.js";
import type { EmbedTokenClaims } from "../domain/embed-token.service.js";

const merchantId = "merchant_identity_fixture";
const secret = "embed-buyer-identity-fixture-secret";
const jwt = new BuyerJwtService(secret, 3600);
const claims = (nonce = crypto.randomUUID()): EmbedTokenClaims => ({
  typ: "aacp_embed_v1", merchantId, nonce, issuedAtUnix: 1, expiresAtUnix: 9999999999,
});
const body = () => ({
  merchant_id: "forged-merchant",
  global_user_id: "forged-buyer",
  cart: { currency: "BRL" as const, total: 0.01, items: [{ sku: "sku", name: "forged", price: 0.01, quantity: 1 }] },
  customer: { email: "forged@example.test", fullName: "Forged", email_verified: true, phone_verified: true, address_verified: true },
});

async function fixture() {
  const buyers = new InMemoryBuyerAccountRepository();
  for (const id of ["buyer-a", "buyer-b"]) {
    await buyers.save(new BuyerAccount({
      globalUserId: id, email: `${id}@example.test`, displayName: id, passwordHash: "fixture-hash",
      phone: "11999990000", cpf: "52998224725", asaasCustomerId: `cus_${id}`,
      address: { zip: "01001000", street: "Fixture street", number: "10", city: "Sao Paulo", state: "SP" },
      createdAt: new Date(), updatedAt: new Date(),
    }));
  }
  const resolver = new ResolveEmbedBuyerService(jwt, buyers);
  const sessions = new InMemoryCheckoutRepository();
  const authority = new CheckoutCartAuthorityService({
    productVariant: { async findMany(query: any) {
      if (query.where.product.merchantId !== merchantId || !query.where.sku.in.includes("sku")) return [];
      return [{ id: "variant", productId: "product", sku: "sku", product: { merchantId, name: "Catalog item", type: "physical" },
        price: { basePriceInCents: 10000, costInCents: 1000, currency: "BRL" }, stock: [{ quantity: 10, reserved: 0 }], media: [] }];
    } },
    productPromotion: { async findMany() { return []; } },
  } as never, {} as never);
  const start = createStartCheckoutUseCase(sessions, sessions, { cartAuthority: authority });
  const controller = new EmbedCheckoutController(start, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, resolver);
  const token = (id = "buyer-a", boundMerchant?: string) => jwt.sign({ globalUserId: id, email: `${id}@example.test`, merchantId: boundMerchant });
  return { buyers, resolver, sessions, start, controller, token };
}

test("embed buyer proof loads the database profile and proves email only", async () => {
  const { resolver, token } = await fixture();
  const trusted = await resolver.resolve(merchantId, token("buyer-a", merchantId));
  assert.equal(trusted?.globalUserId, "buyer-a");
  assert.equal(trusted?.customer.email, "buyer-a@example.test");
  assert.equal(trusted?.customer.email_verified, true);
  assert.equal(trusted?.customer.phone_verified, undefined);
  assert.equal(trusted?.customer.address_verified, undefined);
  assert.equal(trusted?.customer.asaasCustomerId, "cus_buyer-a");
  assert.equal(trusted?.customer.address?.street, "Fixture street");
});

test("absent proof is anonymous; provided malformed, expired or tampered proof fails closed", async () => {
  const { resolver, token } = await fixture();
  assert.equal(await resolver.resolve(merchantId, undefined), undefined);
  const expired = jwt.sign({ globalUserId: "buyer-a", email: "buyer-a@example.test" }, Math.floor(Date.now() / 1000) - 3601);
  for (const invalid of [null, false, 123, {}, [], "", " ", "x".repeat(8193), "malformed", `${token()}x`, expired]) {
    await assert.rejects(resolver.resolve(merchantId, invalid), /embed_buyer_token_invalid/);
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "buyer-a", email: "buyer-a@example.test", role: "buyer", aud: "buyer" })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  await assert.rejects(resolver.resolve(merchantId, `${header}.${payload}.${signature}`), /embed_buyer_token_invalid/);
});

test("buyer proof rejects merchant mismatch, deleted accounts and stale token email", async () => {
  const { resolver, token } = await fixture();
  await assert.rejects(resolver.resolve(merchantId, token("buyer-a", "other-merchant")), /embed_buyer_merchant_mismatch/);
  await assert.rejects(resolver.resolve(merchantId, token("missing")), /embed_buyer_token_invalid/);
  await assert.rejects(resolver.resolve(merchantId, jwt.sign({ globalUserId: "buyer-a", email: "old@example.test" })), /embed_buyer_token_invalid/);
});

test("embed start carries authenticated identity internally, overriding forged body hints and prices", async () => {
  const { controller, token, sessions } = await fixture();
  const result = await controller.start({ embedClaims: claims() }, { ...body(), buyer_access_token: token() });
  const session = sessions.getSession(merchantId, result.session_id)!;
  assert.equal(result.global_user_id, "buyer-a");
  assert.equal(session.customer?.email_verified, true);
  assert.equal(session.customer?.fullName, "buyer-a");
  assert.equal(session.customer?.phone_verified, undefined);
  assert.equal(session.customer?.address_verified, undefined);
  assert.equal(session.cart.items[0]?.price, 100);
  assert.equal(JSON.stringify(session).includes(token()), false);
});

test("without buyer proof, forged global id and verification flags cannot authenticate a checkout", async () => {
  const { controller, sessions } = await fixture();
  const result = await controller.start({ embedClaims: claims() }, body());
  const session = sessions.getSession(merchantId, result.session_id)!;
  assert.notEqual(result.global_user_id, "forged-buyer");
  assert.notEqual(session.customer?.email_verified, true);
  assert.notEqual(session.customer?.phone_verified, true);
  assert.notEqual(session.customer?.address_verified, true);
});

test("direct checkout start also ignores the untrusted global_user_id body field", async () => {
  const { start } = await fixture();
  const result = await start.execute({ ...body(), merchant_id: merchantId });
  assert.notEqual(result.global_user_id, "forged-buyer");
});

test("embed reentry accepts the same buyer and rejects another buyer or missing proof", async () => {
  const { controller, token, sessions } = await fixture();
  const request = { embedClaims: claims() };
  const first = await controller.start(request, { ...body(), buyer_access_token: token() });
  const second = await controller.start(request, { ...body(), buyer_access_token: token() });
  assert.equal(second.session_id, first.session_id);
  await assert.rejects(controller.start(request, { ...body(), buyer_access_token: token("buyer-b") }), /checkout_buyer_session_binding_mismatch/);
  await assert.rejects(controller.start(request, body()), /checkout_buyer_proof_required/);
  assert.equal(sessions.getSession(merchantId, first.session_id)?.globalUserId, "buyer-a");
});

test("concurrent starts with different buyers cannot replace the winning session identity", async () => {
  const { controller, token, sessions } = await fixture();
  const request = { embedClaims: claims() };
  const results = await Promise.allSettled(["buyer-a", "buyer-b"].map(id => controller.start(request, { ...body(), buyer_access_token: token(id) })));
  const successes = results.filter(result => result.status === "fulfilled");
  assert.equal(successes.length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const winner = successes[0]!.value;
  assert.equal(sessions.getSession(merchantId, winner.session_id)?.globalUserId, winner.global_user_id);
});

test("login after an anonymous embed start requires a fresh capability instead of changing the session owner", async () => {
  const { controller, token } = await fixture();
  const request = { embedClaims: claims() };
  await controller.start(request, body());
  await assert.rejects(controller.start(request, { ...body(), buyer_access_token: token() }), /checkout_buyer_session_binding_mismatch/);
  const fresh = await controller.start({ embedClaims: claims() }, { ...body(), buyer_access_token: token() });
  assert.equal(fresh.global_user_id, "buyer-a");
});
