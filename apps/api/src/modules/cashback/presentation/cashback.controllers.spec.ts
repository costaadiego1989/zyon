import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CashbackService } from "../application/cashback.service.js";
import type { CashbackQueriesService } from "../application/cashback-queries.service.js";
import { CashbackBuyerController, CashbackEmbedController, CashbackMerchantController } from "./cashback.controllers.js";
import type { EmbedCheckoutGuardHelper, EmbedHttpRequest } from "../../embed/presentation/http/embed-checkout.controller.js";

test("CB-04 merchant routes derive tenant from owner/admin claims without billing gates", async () => {
  const service = { getProgram: (merchantId: string) => ({ merchantId, status: "disabled", draft: null, published: null, version: 0, updatedAt: null }) } as unknown as CashbackService;
  const controller = new CashbackMerchantController(service, {} as CashbackQueriesService);
  for (const role of ["owner", "admin"]) {
    const result = await controller.getProgram({ user: { merchantId: "actual-merchant", userId: "operator", role } });
    assert.equal(result.merchantId, "actual-merchant"); assert.equal(result.draft, null);
  }
  assert.throws(() => controller.getProgram({ user: { merchantId: "m", userId: "staff", role: "staff" } }), /permission_denied/);
  assert.throws(() => controller.getProgram({}), /missing_authenticated_user/);
});

test("CB-20 buyer routes isolate claim merchant and cannot select another buyer", async () => {
  const controller = new CashbackBuyerController({ wallet: (merchantId: string, buyerId: string) => ({ merchantId, buyerId }) } as unknown as CashbackService,
    { transactions: (merchantId: string, query: { buyerId: string }) => ({ merchantId, buyerId: query.buyerId }) } as unknown as CashbackQueriesService);
  const req = { user: { globalUserId: "self", merchantId: "store-a", role: "buyer", aud: "buyer" } };
  assert.deepEqual(await controller.wallet(req, "store-a"), { merchantId: "store-a", buyerId: "self" });
  await assert.rejects(controller.wallet(req, "store-b"), /merchant_binding_required/);
  assert.deepEqual(await controller.transactions(req, { merchant_id: "store-a", buyerId: "victim" }), { merchantId: "store-a", buyerId: "self" });
  await assert.rejects(controller.wallet({}, "store-a"), /missing_authenticated_buyer/);
});

test("CB-20 global buyer tokens require a persisted membership in requested merchant", async () => {
  const controller = new CashbackBuyerController({ repository: { prisma: { $queryRaw: async () => [{ valid: false }] } }, wallet: () => assert.fail("unauthorized wallet read") } as unknown as CashbackService, {} as CashbackQueriesService);
  const req = { user: { globalUserId: "buyer", role: "buyer", aud: "buyer" } };
  await assert.rejects(controller.wallet(req, "unrelated"), /merchant_binding_required/);
  await assert.rejects(controller.wallet(req), /merchant_binding_required/);
});

test("CB-13 embed uses signed merchant and stored session instead of browser cart or buyer", async () => {
  const session = { merchantId: "signed-store", sessionId: "signed-session", globalUserId: "stored-buyer", cart: { total: 100 } };
  const guards = { assertSessionBelongsToEmbedMerchant: async (claims: { merchantId: string }, id: string) => { assert.equal(claims.merchantId, "signed-store"); assert.equal(id, "signed-session"); }, loadSession: async () => session } as unknown as EmbedCheckoutGuardHelper;
  const service = { quoteCheckout: async (value: unknown) => value, reserveCheckout: async (value: unknown, amount: number, key: string) => ({ session: value, amount, key }) } as unknown as CashbackService;
  const controller = new CashbackEmbedController(service, guards); const request = { embedClaims: { merchantId: "signed-store" } } as EmbedHttpRequest;
  const body = { session_id: "signed-session", merchant_id: "other-store", buyer_global_user_id: "victim", cart: { total: 0 } };
  assert.deepEqual(await controller.quote(request, body), session);
  assert.deepEqual(await controller.reserve(request, { ...body, amount_cents: 1000, idempotency_key: "key" }), { session, amount: 1000, key: "key" });
  await assert.rejects(controller.quote({} as EmbedHttpRequest, body), /session_required/);
});
