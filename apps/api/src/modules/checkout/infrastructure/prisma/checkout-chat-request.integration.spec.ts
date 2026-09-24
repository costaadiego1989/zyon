import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Body, Controller, ForbiddenException, HttpCode, HttpException, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import type { ChatMessageRequest, ChatMessageResponse } from "@zyon/shared-types";
import { CheckoutChatRequestService } from "./checkout-chat-request.service.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { createSendChatUseCase } from "../../application/use-cases/send-chat-message.fixture.js";
import { SafeAuthorizedOffer } from "../../domain/types/safe-authorized-offer.js";
import { chatMessageIdentity } from "../../domain/services/chat-message-identity.js";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { ProblemDetailsFilter } from "../../../../shared/http/problem-details.filter.js";

const url = new URL(process.env.CHECKOUT_CHAT_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557" && url.pathname === "/revenue_chat_requests_0924";
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const env = { ...process.env };
const originalFetch = globalThis.fetch;
const service = new CheckoutChatRequestService(prisma);
const repo = new PrismaCheckoutRepository(prisma);
before(async () => { if (enabled) await prisma.$connect(); });
after(async () => { await prisma.$disconnect(); process.env = env; globalThis.fetch = originalFetch; });
beforeEach(async () => {
  if (!enabled) return;
  process.env = { ...env, CHECKOUT_CHAT_REQUESTS_ENABLED: "true", CHECKOUT_CHAT_REQUEST_MERCHANT_IDS: "store,other",
    REVENUE_STRATEGY_EXECUTION_ENABLED: "false" };
  globalThis.fetch = (async () => { throw new Error("EXTERNAL_NETWORK_FORBIDDEN"); }) as typeof fetch;
  await prisma.$executeRawUnsafe("TRUNCATE checkout_sessions CASCADE");
});
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !enabled, timeout: 30_000 }, fn);
const input = (messageId = "message_00000001", merchantId = "store"): ChatMessageRequest => ({
  merchant_id: merchantId, session_id: "session", conversation_id: "conversation", user_message: "Olá", message_id: messageId,
});
const response = (): ChatMessageResponse => ({ message: "Informe seu nome.", objection: "unknown", actions: [], turns: [] });
const noPreflight = async () => {};
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function seed(merchantId = "store") {
  const now = new Date().toISOString();
  await repo.saveSession({ merchantId, sessionId: "session", conversationId: "conversation", globalUserId: "buyer",
    cart: { currency: "BRL", total: 100, items: [], source: "storefront" }, cohort: "treatment", chatHistory: [],
    abandonmentScore: 0, triggerAgent: false, createdAt: now, updatedAt: now });
}
const code = (expected: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof HttpException);
  assert.equal((error.getResponse() as { code: string }).code, expected);
  if (status) assert.equal(error.getStatus(), status);
  return true;
};

integration("concurrent retries enter the workflow and preflight exactly once", async () => {
  await seed();
  const entered = barrier(), finish = barrier();
  let checks = 0, effects = 0;
  const first = service.run(input(), async () => { checks++; }, async () => { effects++; entered.release(); await finish.promise; return response(); });
  await entered.promise;
  try {
    const duplicates = await Promise.allSettled(Array.from({ length: 10 }, () => service.run(input(), async () => { checks++; }, async () => { effects++; return response(); })));
    for (const duplicate of duplicates) {
      assert.equal(duplicate.status, "rejected");
      if (duplicate.status === "rejected") code("CHAT_MESSAGE_IN_PROGRESS", 409)(duplicate.reason);
    }
  } finally { finish.release(); }
  const result = await first;
  assert.deepEqual(result.chat_request, { message_id: input().message_id, status: "completed" });
  assert.equal(checks, 1); assert.equal(effects, 1);
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  assert.equal(row.status, "completed"); assert.equal(row.responseHash, digest(result));
  assert.ok(row.finishedAt! >= row.startedAt);
});

integration("completed retry returns only a receipt, even after the session or offer changes", async () => {
  await seed();
  let effects = 0;
  await service.run(input(), noPreflight, async () => { effects++; return { ...response(), message: "Mensagem antiga" }; });
  await prisma.checkoutSession.updateMany({ data: { cart: { currency: "BRL", total: 999 } } });
  await assert.rejects(service.run(input(), noPreflight, async () => { effects++; return response(); }), error => {
    code("CHAT_MESSAGE_ALREADY_COMPLETED", 409)(error);
    const body = (error as HttpException).getResponse() as any;
    assert.deepEqual(Object.keys(body).sort(), ["chat_request", "code"]);
    assert.equal(body.chat_request.next_action, "refresh_session");
    return true;
  });
  assert.equal(effects, 1);
  await service.run(input("message_00000002"), noPreflight, async () => { effects++; return response(); });
  assert.equal(effects, 2);
});

integration("changed text or agent cannot reuse the same message ID", async () => {
  await seed();
  await service.run(input(), noPreflight, async () => response());
  for (const patch of [{ user_message: "Outro texto" }, { agent_id: "another" }, { agent_user_id: "another" }, { conversation_id: "other" }]) {
    await assert.rejects(service.run({ ...input(), ...patch }, noPreflight, async () => { assert.fail("must not execute"); }), code("CHAT_MESSAGE_KEY_CONFLICT", 409));
  }
});

integration("merchant, session and conversation scope are enforced before workflow effects", async () => {
  await seed();
  await assert.rejects(service.run(input(undefined, "foreign"), noPreflight, async () => response()), code("CHECKOUT_SESSION_NOT_FOUND", 404));
  await assert.rejects(service.run({ ...input(), conversation_id: "foreign-conversation" }, noPreflight, async () => response()), code("CHAT_CONVERSATION_MISMATCH", 409));
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, async () => response()), code("CHAT_MESSAGE_ID_REQUIRED", 400));
  assert.equal(await prisma.checkoutChatRequest.count(), 0);
  await seed("other");
  await Promise.all(["store", "other"].map(store => service.run(input(undefined, store), noPreflight, async () => response())));
  assert.equal(await prisma.checkoutChatRequest.count(), 2);
});

integration("a different key cannot run while the session has an in-flight message", async () => {
  await seed();
  const entered = barrier(), finish = barrier();
  const first = service.run(input(), noPreflight, async () => { entered.release(); await finish.promise; return response(); });
  await entered.promise;
  try {
    await assert.rejects(service.run(input("message_00000002"), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_IN_PROGRESS"));
  } finally { finish.release(); }
  await first;
  assert.equal(await prisma.checkoutChatRequest.count(), 1);
});

integration("effect failure becomes unknown and blocks old and new keys after flag rollback", async () => {
  await seed();
  let effects = 0;
  await assert.rejects(service.run(input(), noPreflight, async () => { effects++; throw new Error("possible provider acceptance"); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
  process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  process.env.CHECKOUT_CHAT_REQUEST_MERCHANT_IDS = "";
  for (const messageId of ["message_00000001", "message_00000002"]) {
    await assert.rejects(new CheckoutChatRequestService(prisma).run(input(messageId), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 409));
  }
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ID_REQUIRED"));
  assert.equal(effects, 1);
});

integration("completed ownership survives flag rollback and cannot fall through to legacy", async () => {
  await seed();
  await service.run(input(), noPreflight, async () => response());
  process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  await assert.rejects(service.run(input(), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ALREADY_COMPLETED"));
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ID_REQUIRED"));
  const next = await service.run(input("message_00000002"), noPreflight, async () => response());
  assert.equal(next.chat_request?.status, "completed");
});

integration("preflight rejection allows a new message but never replays the rejected key", async () => {
  await seed();
  let effects = 0;
  await assert.rejects(service.run(input(), async () => { throw new ForbiddenException({ code: "merchant_sales_suspended" }); }, async () => { effects++; return response(); }), code("merchant_sales_suspended", 403));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "rejected");
  await assert.rejects(service.run(input(), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_REJECTED"));
  await service.run(input("message_00000002"), noPreflight, async () => { effects++; return response(); });
  assert.equal(effects, 1);
});

integration("unclaimed stores preserve legacy flow and do not claim a message silently", async () => {
  await seed(); process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  let checks = 0, effects = 0;
  const request = { ...input(), message_id: undefined };
  for (let i = 0; i < 2; i++) {
    const result = await service.run(request, async () => { checks++; }, async () => { effects++; return response(); });
    assert.equal(result.chat_request, undefined);
  }
  assert.equal(checks, 2); assert.equal(effects, 2); assert.equal(await prisma.checkoutChatRequest.count(), 0);
});

integration("caller mutation during admission cannot change the message executed under a claim", async () => {
  await seed();
  const original = input();
  const running = service.run(original, noPreflight, async request => { assert.equal(request.user_message, "Olá"); assert.ok(Object.isFrozen(request)); return response(); });
  original.user_message = "changed while awaiting database";
  await running;
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).requestHash, chatMessageIdentity(input()).requestHash);
});

integration("crashed claim cannot be taken over by another process or a new key", async () => {
  await seed();
  const request = input();
  await prisma.checkoutChatRequest.create({ data: { id: "crashed-worker", merchantId: "store", sessionId: "session",
    conversationId: "conversation", messageId: request.message_id!, requestHash: chatMessageIdentity(request).requestHash,
    status: "processing", startedAt: new Date(Date.now() - 24 * 3_600_000) } });
  for (const messageId of ["message_00000001", "message_00000002"]) {
    await assert.rejects(service.run(input(messageId), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_IN_PROGRESS"));
  }
});

integration("database guards forbid initial terminal states, foreign conversations and concurrent lanes", async () => {
  await seed();
  const data = { id: "raw-one", merchantId: "store", sessionId: "session", conversationId: "conversation",
    messageId: input().message_id!, requestHash: chatMessageIdentity(input()).requestHash, status: "processing", startedAt: new Date() };
  await assert.rejects(prisma.checkoutChatRequest.create({ data: { ...data, status: "completed", responseHash: "a".repeat(64), finishedAt: new Date() } }), /INVALID_INITIAL_STATE/);
  await assert.rejects(prisma.checkoutChatRequest.create({ data: { ...data, conversationId: "wrong" } }), /SESSION_MISMATCH/);
  await prisma.checkoutChatRequest.create({ data });
  await assert.rejects(prisma.checkoutChatRequest.create({ data: { ...data, id: "raw-two", messageId: "message_00000002" } }));
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: "raw-one" }, data: { requestHash: "b".repeat(64), status: "unknown", finishedAt: new Date() } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: "raw-one" }, data: { status: "completed", finishedAt: new Date() } }));
  await prisma.checkoutChatRequest.update({ where: { id: "raw-one" }, data: { status: "unknown", finishedAt: new Date() } });
  await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: "raw-one" }, data: { status: "processing", finishedAt: null } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatRequest.delete({ where: { id: "raw-one" } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutSession.deleteMany());
});

integration("completion database failure releases no response and keeps durable uncertainty", async () => {
  await seed();
  // Real transaction rollback, including a successful update before injected failure.
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatRequest") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatRequest, { get(delegate, method) {
        if (method !== "updateMany") return Reflect.get(delegate, method);
        return async (args: any) => { const result = await delegate.updateMany(args); if (args.data.status === "completed") throw new Error("SIMULATED_COMMIT_FAILURE"); return result; };
      } });
    } })));
  } }) as PrismaClient;
  let effects = 0;
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  assert.equal(row.status, "unknown"); assert.equal(row.responseHash, null);
  await assert.rejects(service.run(input(), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
  assert.equal(effects, 1);
});

integration("failure to record both completion and uncertainty preserves the original processing claim", async () => {
  await seed();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatRequest") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatRequest, { get(delegate, method) {
        if (method !== "updateMany") return Reflect.get(delegate, method);
        return async () => { throw new Error("DATABASE_FINALIZATION_UNAVAILABLE"); };
      } });
    } })));
  } }) as PrismaClient;
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, async () => response()), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "processing");
  await assert.rejects(service.run(input("message_00000002"), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_IN_PROGRESS"));
});

integration("lost database acknowledgement after commit cannot downgrade or replay the completed workflow", async () => {
  await seed();
  let transactions = 0, effects = 0;
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return async (fn: any) => {
      const result = await target.$transaction(fn);
      if (++transactions === 2) throw new Error("ACKNOWLEDGEMENT_LOST_AFTER_COMMIT");
      return result;
    };
  } }) as PrismaClient;
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "completed");
  await assert.rejects(service.run(input(), noPreflight, async () => { effects++; return response(); }), code("CHAT_MESSAGE_ALREADY_COMPLETED"));
  assert.equal(effects, 1);
});

integration("real SendChatMessage persists one conversation exchange for concurrent duplicate requests", async () => {
  await seed();
  const entered = barrier(), finish = barrier();
  let customerCalls = 0, quotaCalls = 0, rateCalls = 0;
  const useCase = createSendChatUseCase(repo, { chatRequests: service,
    orderQuota: { async assertCanAcceptNewSales() { quotaCalls++; return {} as any; } },
    conversationRateLimit: { async assertAllowed() { rateCalls++; } },
    customerService: { async correctCustomerInput() { return undefined; }, async processCustomerInput(session: any) {
      customerCalls++; entered.release(); await finish.promise; return session;
    } } as any,
    shippingService: { async processShippingState(session: any) { return session; }, summarizeDelivery() { return undefined; } } as any,
    offerService: { async authorizeOffer(_text: string, session: any) { return SafeAuthorizedOffer.noOffer(session.merchantId, session.sessionId); } } as any,
    conversation: { async reply() { return { message: "Qual é seu nome?", objection: "unknown" as const }; } },
  });
  const first = useCase.execute(input());
  await entered.promise;
  try { await assert.rejects(useCase.execute(input()), code("CHAT_MESSAGE_IN_PROGRESS")); }
  finally { finish.release(); }
  const result = await first;
  assert.equal(result.chat_request?.status, "completed");
  const session = await repo.getSession("store", "session");
  assert.equal(session?.chatHistory.length, 2);
  assert.deepEqual(session?.chatHistory.map(turn => turn.role), ["buyer", "agent"]);
  assert.equal(customerCalls, 1); assert.equal(quotaCalls, 1); assert.equal(rateCalls, 1);
  await assert.rejects(useCase.execute(input()), code("CHAT_MESSAGE_ALREADY_COMPLETED"));
  assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
});

integration("partial conversation failure is retained without appending the buyer twice", async () => {
  await seed();
  await assert.rejects(service.run(input(), noPreflight, async () => {
    await repo.appendChatTurn("store", "session", { role: "buyer", text: "Olá", occurredAt: new Date().toISOString() });
    throw new Error("interrupted before agent persistence");
  }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
  await assert.rejects(service.run(input(), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
  assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 1);
});

integration("loopback HTTP preserves a completed receipt through Nest, real chat, PostgreSQL and the global error filter", async () => {
  await seed();
  let customerCalls = 0;
  const useCase = createSendChatUseCase(repo, { chatRequests: service,
    customerService: { async correctCustomerInput() { return undefined; }, async processCustomerInput(session: any) { customerCalls++; return session; } } as any,
    shippingService: { async processShippingState(session: any) { return session; }, summarizeDelivery() { return undefined; } } as any,
    offerService: { async authorizeOffer(_text: string, session: any) { return SafeAuthorizedOffer.noOffer(session.merchantId, session.sessionId); } } as any,
    conversation: { async reply() { return { message: "Qual é seu nome?", objection: "unknown" as const }; } },
  });
  // Fixture-only HTTP controller: production tenant/auth guards are exercised
  // separately by controller tests. Only the transport/workflow/filter are real here.
  @Controller("receipt-fixture")
  class FixtureController {
    @Post() @HttpCode(200)
    send(@Body() body: ChatMessageRequest) { return useCase.execute(body); }
  }
  @Module({ controllers: [FixtureController] })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  app.useGlobalFilters(new ProblemDetailsFilter());
  try {
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    assert.equal(new URL(origin).hostname, "127.0.0.1");
    const post = () => originalFetch(`${origin}/receipt-fixture`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(input()) });
    const first = await post();
    assert.equal(first.status, 200);
    assert.equal((await first.json() as ChatMessageResponse).chat_request?.status, "completed");
    const duplicate = await post();
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.headers.get("content-type") ?? "", /application\/problem\+json/);
    const problem = await duplicate.json() as any;
    assert.equal(problem.code, "chat_message_already_completed");
    assert.deepEqual(problem.chat_request, { message_id: input().message_id, status: "completed", next_action: "refresh_session" });
    assert.equal(problem.authorized_offer, undefined);
    assert.equal(customerCalls, 1);
    assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
  } finally { await app.close(); }
});
