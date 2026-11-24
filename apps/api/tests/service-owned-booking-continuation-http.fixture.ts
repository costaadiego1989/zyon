import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type OwnedRuntime = {
  apiOrigin: string;
  buyerBooking?: { issue(input: { merchantId: string; body: Record<string, unknown> }): Promise<{ status: number; body: any }> };
};
type Preparation = {
  merchantId: string;
  origin: string;
  productId: string;
  variantId: string;
  professionalId: string;
  date: string;
  scopes: string[];
  buyer: { email: string; displayName: string; phone?: string };
};

/** T40's ordinary synthetic account precondition followed by real login and
 * public booking HTTP. Only account credentials/profile are seeded. The app
 * creates the conversation, parent cart, checkout and all private authority. */
export async function createOwnedBookingContinuation(runtime: OwnedRuntime, prisma: PrismaClient) {
  assert.ok(runtime.buyerBooking, "owned_buyer_booking_runtime_required");
  const issuer = runtime.buyerBooking;
  const { PasswordHasher } = await import("../dist/modules/auth/domain/services/password-hasher.service.js");
  const password = "SyntheticBuyerPassword123!", passwordHash = await new PasswordHasher().hash(password);
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") => {
    const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", "x-correlation-id": randomUUID(), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return async (input: Preparation) => {
    const account = await prisma.buyerAccount.upsert({ where: { email: input.buyer.email }, update: {},
      create: { globalUserId: "buyer_" + randomUUID().replaceAll("-", ""), passwordHash, ...input.buyer } });
    assert.equal(account.displayName, input.buyer.displayName);
    assert.equal(account.phone ?? undefined, input.buyer.phone);
    const login = await request("/buyer/login", { email: account.email, password });
    assert.equal(login.status, 201, JSON.stringify(login));
    assert.equal(login.body.globalUserId, account.globalUserId);
    const buyerToken = login.body.accessToken as string;
    const conversation = await request("/storefront/conversations", { merchant_id: input.merchantId,
      buyer_access_token: buyerToken }, { origin: input.origin });
    assert.equal(conversation.status, 201, JSON.stringify(conversation));
    const issued = await issuer.issue({ merchantId: input.merchantId, body: {
      cart_ref: conversation.body.conversation_id, conversation_token: conversation.body.conversation_token,
      allowed_origin: input.origin, buyer_access_token: buyerToken, scopes: input.scopes, ttl_seconds: 900 } });
    assert.equal(issued.status, 201, JSON.stringify(issued));
    const token = issued.body.embed_session_token as string;
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    assert.equal(claims.merchantId, input.merchantId);
    assert.equal(claims.storefrontCartRef, conversation.body.conversation_id);
    assert.equal(claims.allowedOrigin, input.origin);
    assert.ok(claims.scopes.includes("appointments:confirm"));
    const headers = { origin: input.origin, "x-aacp-embed-token": token, "x-buyer-access-token": buyerToken };
    const query = new URLSearchParams({ productId: input.productId, variantId: input.variantId,
      professionalId: input.professionalId, date: input.date });
    const slots = await request("/embed/service-booking/slots?" + query, undefined, headers, "GET");
    assert.equal(slots.status, 200, JSON.stringify(slots));
    const selection = slots.body.selections.find((slot: any) => slot.startsAt === input.date + "T10:00:00.000Z"
      && slot.endsAt === input.date + "T10:20:00.000Z");
    assert.ok(selection, "original_absolute_service_interval_must_be_available");
    const selected = await request("/embed/service-booking/select", { selection }, headers);
    assert.equal(selected.status, 201, JSON.stringify(selected));
    const prepared = await request("/embed/service-booking/prepare", { selection: selected.body.selection,
      parent_cart_fingerprint: selected.body.parent_cart_fingerprint }, headers);
    assert.equal(prepared.status, 201, JSON.stringify(prepared));
    assert.equal(prepared.body.confirmed, false);
    const checkout = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: {
      merchantId: input.merchantId, sessionId: prepared.body.session_id } } });
    assert.equal(checkout.globalUserId, account.globalUserId);
    assert.equal((checkout.cart as any).cart_ref, conversation.body.conversation_id);
    return { issued, buyerToken, prepared, cart: checkout.cart, account };
  };
}
