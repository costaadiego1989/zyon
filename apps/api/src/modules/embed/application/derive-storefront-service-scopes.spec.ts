import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { ResolveEmbedBuyerService } from "./resolve-embed-buyer.service.js";
import { AuthorizeStorefrontCartService } from "./authorize-storefront-cart.service.js";
import { DeriveStorefrontServiceScopes } from "./derive-storefront-service-scopes.js";
const scopes = ["checkout:start", "checkout:chat", "payment:intents:read"];
function fixture() {
  const conversations = new RealtimeCapabilityService("owned-fixture-conversation-secret-32-characters");
  const jwt = new BuyerJwtService("owned-fixture-buyer-secret-32-characters");
  const buyer = { globalUserId: "buyer-a", email: "buyer@example.invalid" };
  const merchant = { businessMode: "services", businessModeSelectedAt: new Date(), businessModeNeedsReview: false };
  const service = new DeriveStorefrontServiceScopes({ merchant: { findUnique: async () => merchant } } as never,
    new ResolveEmbedBuyerService(jwt, { findByGlobalUserId: async (id: string) => id === buyer.globalUserId ? buyer : null } as never), new AuthorizeStorefrontCartService(conversations));
  const issue = (override = {}) => conversations.issue({ purpose: "storefront-conversation", merchantId: "merchant-a", resourceId: "conversation-a", origin: "https://store.example.invalid", aiUserId: "visitor:visitor-a", ...override }).token;
  const input = { merchantId: "merchant-a", cartRef: "conversation-a", origin: "https://store.example.invalid", conversationToken: issue(), buyerToken: jwt.sign(buyer), scopes };
  return { service, input, merchant, jwt, issue };
}
test("T45 existing issuer derives confirmation for real service buyer without requiring a parent cart", async () => {
  const f = fixture(); assert.deepEqual(await f.service.execute(f.input), [...scopes, "appointments:confirm"]); assert.deepEqual(f.input.scopes, scopes);
});
test("T45 products and unresolved company modes preserve every existing requested scope", async () => {
  const f = fixture(); f.merchant.businessMode = "products";
  assert.deepEqual(await f.service.execute({ ...f.input, buyerToken: "malformed" }), scopes);
  f.merchant.businessMode = "services"; f.merchant.businessModeNeedsReview = true;
  assert.deepEqual(await f.service.execute(f.input), scopes);
});
test("T45 existing explicitly authorized internal issuer grants remain unchanged without new buyer preconditions", async () => {
  const f = fixture(); const explicit = [...scopes, "appointments:confirm"];
  assert.deepEqual(await f.service.execute({ ...f.input, buyerToken: undefined, scopes: explicit }), explicit);
});
test("T45 service grants require actual buyer authentication and exact signed tenant/cart/origin", async () => {
  const f = fixture(); assert.deepEqual(await f.service.execute({ ...f.input, buyerToken: undefined }), scopes);
  for (const override of [{ merchantId: "foreign" }, { cartRef: "foreign" }, { origin: "https://foreign.example.invalid" }, { conversationToken: "forged" }, { buyerToken: "forged" }, { buyerToken: f.jwt.sign({ globalUserId: "buyer-a", email: "wrong@example.invalid" }) }, { buyerToken: f.jwt.sign({ globalUserId: "buyer-a", email: "buyer@example.invalid", merchantId: "foreign" }) }, { conversationToken: f.issue({ aiUserId: "buyer:foreign" }) }]) await assert.rejects(f.service.execute({ ...f.input, ...override }));
});
test("T45 a validly signed non-buyer role cannot derive a service grant", async () => {
  const f = fixture(); const [header, payload] = f.input.buyerToken.split(".");
  const body = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), role: "OWNER", aud: "console" })).toString("base64url");
  const token = `${header}.${body}.${createHmac("sha256", "owned-fixture-buyer-secret-32-characters").update(`${header}.${body}`).digest("base64url")}`;
  await assert.rejects(f.service.execute({ ...f.input, buyerToken: token }));
});
