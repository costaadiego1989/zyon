import test from "node:test";
import assert from "node:assert/strict";
import { PrismaBuyerConversationRepository } from "./prisma-buyer-conversation.repository.js";
import { GetBuyerConversationUseCase, ListBuyerConversationsUseCase, RateBuyerConversationMessageUseCase } from "../application/use-cases/buyer-conversation.use-cases.js";
import { BuyerHubController } from "../presentation/http/buyer-hub.controller.js";

function fixture() {
  const now = new Date();
  const rows = ["current", "paid", "expired", "legacy", "other-store", "other-buyer"].map((id) => ({
    id, globalUserId: id === "other-buyer" ? "buyer-2" : "buyer-1", merchantId: id === "other-store" ? "store-2" : "store-1",
    sessionId: id, startedAt: now, lastMessageAt: now, messages: [{ id: "message", role: "buyer", content: "Quero conhecer as ofertas", createdAt: now.toISOString(), rating: null }],
  }));
  const calls: any[] = [];
  const prisma = {
    buyerConversation: {
      findMany: async (args: any) => { calls.push(args); return rows.filter((row) => row.globalUserId === args.where.globalUserId && (!args.where.merchantId || row.merchantId === args.where.merchantId)); },
      findFirst: async (args: any) => rows.find((row) => row.id === args.where.id && row.globalUserId === args.where.globalUserId) ?? null,
      update: async () => { throw new Error("unexpected_rating_write"); },
    },
    merchant: { findMany: async () => [{ id: "store-1", name: "Athom" }, { id: "store-2", name: "Outra loja" }] },
    storefrontCart: { findMany: async (args: any) => {
      calls.push(args);
      return ["current", "paid", "expired"].map((sessionId) => ({ merchantId: "store-1", sessionId, expiresAt: new Date(now.getTime() + (sessionId === "expired" ? -60000 : 60000)) }));
    } },
    checkoutSession: { findMany: async (args: any) => {
      calls.push(args);
      return [
        { merchantId: "store-1", globalUserId: "buyer-1", sessionId: "checkout-paid", conversationId: "paid", completedOrders: [{ id: "order" }] },
        { merchantId: "store-2", globalUserId: "buyer-1", sessionId: "current", conversationId: "current", completedOrders: [{ id: "foreign-order" }] },
        { merchantId: "store-1", globalUserId: "buyer-2", sessionId: "current", conversationId: "current", completedOrders: [{ id: "foreign-buyer-order" }] },
      ];
    } },
  };
  const repo = new PrismaBuyerConversationRepository(prisma as never);
  const c = new BuyerHubController(new ListBuyerConversationsUseCase(repo), new GetBuyerConversationUseCase(repo),
    new RateBuyerConversationMessageUseCase(repo), undefined as never, undefined as never, undefined as never);
  return { repo, c, calls };
}

test("conversation projection uses merchant name and scoped completion/expiry evidence, never message text", async () => {
  const { repo, calls } = fixture();
  const list = await repo.listByBuyer("buyer-1", { merchantId: "store-1" });
  assert.deepEqual(list.map((row) => [row.id, row.status, row.merchantName]), [
    ["current", "in_progress", "Athom"], ["paid", "completed", "Athom"], ["expired", "expired", "Athom"], ["legacy", "history", "Athom"],
  ]);
  assert.equal(calls[0].where.globalUserId, "buyer-1");
  assert.equal(calls[0].where.merchantId, "store-1");
  const checkoutQuery = calls.find((call) => call.where.OR?.[0]?.globalUserId);
  assert.ok(checkoutQuery.where.OR.every((scope: any) => scope.globalUserId === "buyer-1" && scope.merchantId === "store-1"));
});

test("authenticated list/detail return readable metadata and preserve buyer roles", async () => {
  const { c } = fixture();
  const req = { user: { globalUserId: "buyer-1", merchantId: "store-1" } };
  const result = await c.listConversations(req, "store-1");
  assert.equal(result.items.length, 4);
  const current = await c.getConversation(req, "current", "store-1");
  assert.equal(current.merchant_name, "Athom");
  assert.equal(current.status, "in_progress");
  assert.equal(current.messages[0].role, "buyer");
  assert.equal((await c.getConversation(req, "paid")).status, "completed");
});

test("list/detail/rating reject foreign merchant and buyer without changing messages", async () => {
  const { c } = fixture();
  const req = { user: { globalUserId: "buyer-1", merchantId: "store-1" } };
  await assert.rejects(c.listConversations(req, "store-2"), (error: any) => error.getStatus() === 403);
  for (const id of ["other-store", "other-buyer"]) {
    await assert.rejects(c.getConversation(req, id), (error: any) => error.getStatus() === 404);
    await assert.rejects(c.rateConversationMessage(req, id, { message_id: "message", rating: "up" }), (error: any) => error.getStatus() === 404);
  }
  await assert.rejects(c.listConversations({}), (error: any) => error.getStatus() === 401);
});

test("normal global login may select a store but cannot acquire another buyer's conversation", async () => {
  const { c } = fixture();
  const req = { user: { globalUserId: "buyer-1" } };
  const result = await c.listConversations(req, "store-2");
  assert.deepEqual(result.items.map((row) => row.id), ["other-store"]);
  await assert.rejects(c.getConversation(req, "other-buyer", "store-1"), (error: any) => error.getStatus() === 404);
  for (const query of [[], {}, " ", "x".repeat(201)]) await assert.rejects(c.listConversations(req, query), (error: any) => error.getStatus() === 400);
});
