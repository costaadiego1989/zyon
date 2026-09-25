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
import { chatMessageIdentity, chatMessageTextHash } from "../../domain/services/chat-message-identity.js";
import { digest } from "../../../experiments/domain/services/measurement-plan.js";
import { ProblemDetailsFilter } from "../../../../shared/http/problem-details.filter.js";
import { OtpValidationError } from "../../application/services/checkout-customer.service.js";
import { ChatResponseBuilder } from "../../application/services/chat-response.builder.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";

const url = new URL(process.env.CHECKOUT_CHAT_TEST_DATABASE_URL ?? "postgresql://invalid/disabled");
const enabled = url.hostname === "127.0.0.1" && url.port === "5557"
  && url.pathname === "/revenue_recovery_final_0924";
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
// Only stub workflows use this helper. The real use-case tests below must write
// their own exchange through the production builder (no service wrapper).
async function completeFixture(request: ChatMessageRequest, claim?: import("../../domain/ports/checkout-session.repository.port.js").ChatExchangeClaim,
  result = response()): Promise<ChatMessageResponse> {
  if (claim) await repo.appendChatExchange({ merchantId: request.merchant_id, sessionId: request.session_id,
    expectedSession: await repo.getSession(request.merchant_id, request.session_id), claim,
    buyer: { role: "buyer", text: request.user_message, occurredAt: new Date().toISOString() },
    agent: { role: "agent", text: result.message, occurredAt: new Date().toISOString() } });
  return result;
}
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

integration("v2 completion without an exchange becomes unknown and never releases a completed response", async () => {
  await seed();
  await assert.rejects(service.run(input(), noPreflight, async () => response()), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "unknown");
  assert.equal(await prisma.checkoutChatExchange.count(), 0);
});

integration("failure after inserting exchange evidence rolls back both messages and evidence", async () => {
  await seed();
  const broken = new Proxy(prisma, { get(target, prop) {
    if (prop !== "$transaction") return Reflect.get(target, prop);
    return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
      if (key !== "checkoutChatExchange") return Reflect.get(transaction, key);
      return new Proxy(transaction.checkoutChatExchange, { get(delegate, method) {
        if (method !== "create") return Reflect.get(delegate, method);
        return async (args: any) => { await delegate.create(args); throw new Error("AFTER_PROOF_INSERT"); };
      } });
    } })));
  } }) as PrismaClient;
  const brokenRepo = new PrismaCheckoutRepository(broken);
  await assert.rejects(service.run(input(), noPreflight, async (request, claim) => {
    await assert.rejects(brokenRepo.appendChatExchange({ merchantId: "store", sessionId: "session", claim,
      expectedSession: await repo.getSession("store", "session"),
      buyer: { role: "buyer", text: request.user_message, occurredAt: new Date().toISOString() },
      agent: { role: "agent", text: response().message, occurredAt: new Date().toISOString() } }), /AFTER_PROOF_INSERT/);
    assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 0);
    assert.equal(await prisma.checkoutChatExchange.count(), 0);
    throw new Error("workflow aborted");
  }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
});

integration("exchange requires the exact buyer, tenant, claim and current session snapshot", async () => {
  await seed(); await seed("other");
  await service.run(input(), noPreflight, async (request, claim) => {
    const expectedSession = (await repo.getSession("store", "session"))!;
    const exchange = { merchantId: "store", sessionId: "session", expectedSession, claim,
      buyer: { role: "buyer" as const, text: request.user_message, occurredAt: new Date().toISOString() },
      agent: { role: "agent" as const, text: response().message, occurredAt: new Date().toISOString() } };
    await assert.rejects(repo.appendChatExchange({ ...exchange, merchantId: "other" }), /CLAIM_CONFLICT/);
    await assert.rejects(repo.appendChatExchange({ ...exchange, claim: { ...claim!, requestHash: "f".repeat(64) } }), /CLAIM_CONFLICT/);
    await assert.rejects(repo.appendChatExchange({ ...exchange, buyer: { ...exchange.buyer, text: "changed" } }), /CLAIM_CONFLICT/);
    await assert.rejects(repo.appendChatExchange({ ...exchange, expectedSession: undefined }), /SESSION_CHANGED/);
    await prisma.checkoutSession.updateMany({ where: { merchantId: "store" }, data: { abandonmentScore: 0.7 } });
    await assert.rejects(repo.appendChatExchange(exchange), /SESSION_CHANGED/);
    assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 0);
    const result = await completeFixture(request, claim);
    assert.equal((await repo.getSession("store", "session"))?.abandonmentScore, 0.7);
    return result;
  });
  assert.equal((await repo.getSession("other", "session"))?.chatHistory.length, 0);
});

integration("concurrent publication under one claim appends exactly one pair", async () => {
  await seed();
  await service.run(input(), noPreflight, async (request, claim) => {
    const expectedSession = await repo.getSession("store", "session");
    const args = { merchantId: "store", sessionId: "session", expectedSession, claim,
      buyer: { role: "buyer" as const, text: request.user_message, occurredAt: new Date().toISOString() },
      agent: { role: "agent" as const, text: response().message, occurredAt: new Date().toISOString() } };
    const results = await Promise.allSettled([repo.appendChatExchange(args), repo.appendChatExchange(args)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await prisma.checkoutChatExchange.count(), 1);
    assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
    return response();
  });
});

integration("stale saves cannot erase a protected pair even after flag rollback; single follow-ups remain valid", async () => {
  await seed(); const stale = (await repo.getSession("store", "session"))!;
  await service.run(input(), noPreflight, completeFixture);
  process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  await assert.rejects(repo.saveSession(stale), /HISTORY_REWRITE_FORBIDDEN/);
  await assert.rejects(prisma.checkoutSession.updateMany({ data: { chatHistory: [] } }), /HISTORY_REWRITE_FORBIDDEN/);
  await repo.appendChatTurn("store", "session", { role: "agent", text: "follow up", occurredAt: new Date().toISOString() });
  assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 3);
  await repo.saveSession((await repo.getSession("store", "session"))!);
});

integration("protected pairs and single follow-ups preserve the last fifty turns", async () => {
  await seed();
  const turns = Array.from({ length: 50 }, (_, i) => ({ role: "agent", text: String(i), occurredAt: new Date().toISOString() }));
  await prisma.checkoutSession.updateMany({ data: { chatHistory: turns } });
  await service.run(input(), noPreflight, completeFixture);
  let session = (await repo.getSession("store", "session"))!;
  assert.equal(session.chatHistory.length, 50); assert.equal(session.chatHistory[0].text, "2");
  await repo.appendChatTurn("store", "session", { role: "agent", text: "follow up", occurredAt: new Date().toISOString() });
  session = (await repo.getSession("store", "session"))!;
  assert.equal(session.chatHistory.length, 50); assert.equal(session.chatHistory[0].text, "3");
  await assert.rejects(prisma.checkoutSession.updateMany({ data: { chatHistory: turns } }), /HISTORY_REWRITE_FORBIDDEN/);
});

integration("database refuses missing pair, forged proof hash and evidence mutation", async () => {
  await seed();
  await service.run(input(), noPreflight, async (request, claim) => {
    const data = { requestId: claim!.requestId, merchantId: "store", sessionId: "session", exchangeHash: "a".repeat(64), recordedAt: new Date() };
    await assert.rejects(prisma.checkoutChatExchange.create({ data }), /PAIR_MISMATCH/);
    await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: claim!.requestId },
      data: { status: "completed", responseHash: "a".repeat(64), finishedAt: new Date() } }), /EXCHANGE_REQUIRED/);
    // Inject a wrong hash at the repository's insert boundary. The database must
    // reject it and roll the already appended pair back, independently of TS checks.
    const broken = new Proxy(prisma, { get(target, prop) {
      if (prop !== "$transaction") return Reflect.get(target, prop);
      return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
        if (key !== "checkoutChatExchange") return Reflect.get(transaction, key);
        return { create: (args: any) => transaction.checkoutChatExchange.create({ data: { ...args.data, exchangeHash: "f".repeat(64) } }) };
      } })));
    } }) as PrismaClient;
    await assert.rejects(new PrismaCheckoutRepository(broken).appendChatExchange({ merchantId: "store", sessionId: "session", claim,
      expectedSession: await repo.getSession("store", "session"),
      buyer: { role: "buyer", text: request.user_message, occurredAt: new Date().toISOString() },
      agent: { role: "agent", text: response().message, occurredAt: new Date().toISOString() } }), /PAIR_MISMATCH/);
    assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 0);
    return completeFixture(request, claim);
  });
  const proof = await prisma.checkoutChatExchange.findFirstOrThrow();
  await assert.rejects(prisma.checkoutChatExchange.update({ where: { requestId: proof.requestId }, data: { exchangeHash: "b".repeat(64) } }), /IMMUTABLE/);
  await assert.rejects(prisma.checkoutChatExchange.delete({ where: { requestId: proof.requestId } }), /IMMUTABLE/);
});

integration("new claims cannot downgrade to v1 or change their buyer digest", async () => {
  await seed();
  const data = { id: "downgrade", merchantId: "store", sessionId: "session", conversationId: "conversation",
    messageId: input().message_id!, requestHash: chatMessageIdentity(input()).requestHash, status: "processing", startedAt: new Date() };
  await assert.rejects(prisma.checkoutChatRequest.create({ data: { ...data, protocolVersion: 1 } }), /PROTOCOL_REQUIRED/);
  await assert.rejects(prisma.checkoutChatRequest.create({ data }));
  await service.run(input(), noPreflight, async (request, claim) => {
    await assert.rejects(prisma.checkoutChatRequest.update({ where: { id: claim!.requestId }, data: {
      status: "unknown", finishedAt: new Date(), buyerMessageHash: "f".repeat(64) } }), /IMMUTABLE/);
    return completeFixture(request, claim);
  });
});

integration("database checks persisted roles, text types, buyer digest, timestamps and request links", async () => {
  await seed();
  await service.run({ ...input(), user_message: "123" }, noPreflight, async (request, claim) => {
    for (const [index, patch] of [[0, { role: "agent" }], [1, { role: "buyer" }], [0, { text: "456" }],
      [0, { text: 123 }], [1, { text: 123 }], [0, { chatRequestId: "wrong" }],
      [1, { occurredAt: "2000-01-01T00:00:00.000Z" }]] as const) {
      const broken = new Proxy(prisma, { get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: any) => target.$transaction(async tx => fn(new Proxy(tx, { get(transaction, key) {
          if (key !== "checkoutSession") return Reflect.get(transaction, key);
          return new Proxy(transaction.checkoutSession, { get(delegate, method) {
            if (method !== "update") return Reflect.get(delegate, method);
            return (args: any) => {
              const history = structuredClone(args.data.chatHistory);
              history[index] = { ...history[index], ...patch };
              return delegate.update({ ...args, data: { ...args.data, chatHistory: history } });
            };
          } });
        } })));
      } }) as PrismaClient;
      await assert.rejects(new PrismaCheckoutRepository(broken).appendChatExchange({ merchantId: "store", sessionId: "session", claim,
        expectedSession: await repo.getSession("store", "session"),
        buyer: { role: "buyer", text: request.user_message, occurredAt: new Date().toISOString() },
        agent: { role: "agent", text: response().message, occurredAt: new Date().toISOString() } }), /PAIR_MISMATCH/);
      assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 0);
      assert.equal(await prisma.checkoutChatExchange.count(), 0);
    }
    return completeFixture(request, claim);
  });
});

integration("unclaimed pairs append atomically without replacing other session fields or forging proof links", async () => {
  await seed(); process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  const expectedSession = (await repo.getSession("store", "session"))!;
  await prisma.checkoutSession.updateMany({ data: { abandonmentScore: 0.8 } });
  const session = await repo.appendChatExchange({ merchantId: "store", sessionId: "session", expectedSession,
    buyer: { role: "buyer", text: "Olá 👋", occurredAt: "2000-01-01T00:00:00.000Z", chatRequestId: "forged" },
    agent: { role: "agent", text: "Olá!", occurredAt: "2000-01-01T00:00:00.000Z", chatRequestId: "forged" } });
  assert.equal(session.abandonmentScore, 0.8); assert.equal(session.chatHistory.length, 2);
  assert.ok(session.chatHistory.every(turn => turn.chatRequestId === undefined && turn.occurredAt !== "2000-01-01T00:00:00.000Z"));
  assert.equal(await prisma.checkoutChatExchange.count(), 0);
});

integration("payment selection saves the freshly persisted pair instead of the pre-reply history", async () => {
  await seed();
  const request = { ...input(), user_message: "pix" };
  let intents = 0;
  const builder = new ChatResponseBuilder(repo, undefined, { async execute() {
    intents++; assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
    return { id: "fixture-intent", status: "pending", amountCents: 10000, currency: "BRL" };
  } } as any);
  const result = await service.run(request, noPreflight, async (message, claim) => builder.build({
    merchantId: "store", sessionId: "session", session: (await repo.getSession("store", "session"))!, chatRequest: claim,
    userMessage: message.user_message, safeMessage: response().message, reply: response(),
    offer: SafeAuthorizedOffer.noOffer("store", "session"), merchant: undefined, rules: DEFAULT_MERCHANT_RULES,
    stage: "payment", previousStage: "payment", missingFields: [], isHoldout: true, preSearchedProducts: [],
  }));
  assert.equal(result.stage, "payment_pending"); assert.equal(intents, 1);
  assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
});

for (const path of ["correction", "otp"] as const) {
  integration(`real use case records a protected pair on the ${path} path`, async () => {
    await seed();
    const useCase = createSendChatUseCase(repo, { chatRequests: service,
      customerService: { async correctCustomerInput(session: any) {
        return path === "correction" ? { session, field: "email", message: "Informe o e-mail correto.", needsInput: true } : undefined;
      }, async processCustomerInput() { throw new OtpValidationError("Código inválido."); } } as any,
    });
    const result = await useCase.execute(input());
    const turns = (await repo.getSession("store", "session"))!.chatHistory;
    assert.equal(turns.length, 2); assert.equal(turns[1].text, result.message);
    assert.equal(turns[0].chatRequestId, turns[1].chatRequestId);
    assert.equal(await prisma.checkoutChatExchange.count(), 1);
    assert.equal(result.chat_request?.status, "completed");
  });
}

integration("concurrent retries enter the workflow and preflight exactly once", async () => {
  await seed();
  const entered = barrier(), finish = barrier();
  let checks = 0, effects = 0;
  const first = service.run(input(), async () => { checks++; }, async (request, claim) => { effects++; entered.release(); await finish.promise; return completeFixture(request, claim); });
  await entered.promise;
  try {
    const duplicates = await Promise.allSettled(Array.from({ length: 10 }, () => service.run(input(), async () => { checks++; }, async (request, claim) => { effects++; return completeFixture(request, claim); })));
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
  await service.run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim, { ...response(), message: "Mensagem antiga" }); });
  await prisma.checkoutSession.updateMany({ data: { cart: { currency: "BRL", total: 999 } } });
  await assert.rejects(service.run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), error => {
    code("CHAT_MESSAGE_ALREADY_COMPLETED", 409)(error);
    const body = (error as HttpException).getResponse() as any;
    assert.deepEqual(Object.keys(body).sort(), ["chat_request", "code"]);
    assert.equal(body.chat_request.next_action, "refresh_session");
    return true;
  });
  assert.equal(effects, 1);
  await service.run(input("message_00000002"), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); });
  assert.equal(effects, 2);
});

integration("changed text or agent cannot reuse the same message ID", async () => {
  await seed();
  await service.run(input(), noPreflight, completeFixture);
  for (const patch of [{ user_message: "Outro texto" }, { agent_id: "another" }, { agent_user_id: "another" }, { conversation_id: "other" }]) {
    await assert.rejects(service.run({ ...input(), ...patch }, noPreflight, async () => { assert.fail("must not execute"); }), code("CHAT_MESSAGE_KEY_CONFLICT", 409));
  }
});

integration("merchant, session and conversation scope are enforced before workflow effects", async () => {
  await seed();
  await assert.rejects(service.run(input(undefined, "foreign"), noPreflight, completeFixture), code("CHECKOUT_SESSION_NOT_FOUND", 404));
  await assert.rejects(service.run({ ...input(), conversation_id: "foreign-conversation" }, noPreflight, completeFixture), code("CHAT_CONVERSATION_MISMATCH", 409));
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, completeFixture), code("CHAT_MESSAGE_ID_REQUIRED", 400));
  assert.equal(await prisma.checkoutChatRequest.count(), 0);
  await seed("other");
  await Promise.all(["store", "other"].map(store => service.run(input(undefined, store), noPreflight, completeFixture)));
  assert.equal(await prisma.checkoutChatRequest.count(), 2);
});

integration("a different key cannot run while the session has an in-flight message", async () => {
  await seed();
  const entered = barrier(), finish = barrier();
  const first = service.run(input(), noPreflight, async (request, claim) => { entered.release(); await finish.promise; return completeFixture(request, claim); });
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
    await assert.rejects(new CheckoutChatRequestService(prisma).run(input(messageId), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 409));
  }
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ID_REQUIRED"));
  assert.equal(effects, 1);
});

integration("completed ownership survives flag rollback and cannot fall through to legacy", async () => {
  await seed();
  await service.run(input(), noPreflight, completeFixture);
  process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  await assert.rejects(service.run(input(), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ALREADY_COMPLETED"));
  await assert.rejects(service.run({ ...input(), message_id: undefined }, noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_ID_REQUIRED"));
  const next = await service.run(input("message_00000002"), noPreflight, completeFixture);
  assert.equal(next.chat_request?.status, "completed");
});

integration("preflight rejection allows a new message but never replays the rejected key", async () => {
  await seed();
  let effects = 0;
  await assert.rejects(service.run(input(), async () => { throw new ForbiddenException({ code: "merchant_sales_suspended" }); }, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("merchant_sales_suspended", 403));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "rejected");
  await assert.rejects(service.run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_REJECTED"));
  await service.run(input("message_00000002"), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); });
  assert.equal(effects, 1);
});

integration("unclaimed stores preserve legacy flow and do not claim a message silently", async () => {
  await seed(); process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
  let checks = 0, effects = 0;
  const request = { ...input(), message_id: undefined };
  for (let i = 0; i < 2; i++) {
    const result = await service.run(request, async () => { checks++; }, async (request, claim) => { effects++; return completeFixture(request, claim); });
    assert.equal(result.chat_request, undefined);
  }
  assert.equal(checks, 2); assert.equal(effects, 2); assert.equal(await prisma.checkoutChatRequest.count(), 0);
});

integration("caller mutation during admission cannot change the message executed under a claim", async () => {
  await seed();
  const original = input();
  const running = service.run(original, noPreflight, async (request, claim) => { assert.equal(request.user_message, "Olá"); assert.ok(Object.isFrozen(request)); return completeFixture(request, claim); });
  original.user_message = "changed while awaiting database";
  await running;
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).requestHash, chatMessageIdentity(input()).requestHash);
});

integration("crashed claim cannot be taken over by another process or a new key", async () => {
  await seed();
  const request = input();
  await prisma.checkoutChatRequest.create({ data: { id: "crashed-worker", merchantId: "store", sessionId: "session",
    conversationId: "conversation", messageId: request.message_id!, requestHash: chatMessageIdentity(request).requestHash,
    buyerMessageHash: chatMessageTextHash(request.user_message), status: "processing", startedAt: new Date(Date.now() - 24 * 3_600_000) } });
  for (const messageId of ["message_00000001", "message_00000002"]) {
    await assert.rejects(service.run(input(messageId), noPreflight, async () => { assert.fail(); }), code("CHAT_MESSAGE_IN_PROGRESS"));
  }
});

integration("database guards forbid initial terminal states, foreign conversations and concurrent lanes", async () => {
  await seed();
  const data = { id: "raw-one", merchantId: "store", sessionId: "session", conversationId: "conversation",
    messageId: input().message_id!, requestHash: chatMessageIdentity(input()).requestHash, buyerMessageHash: chatMessageTextHash(input().user_message), status: "processing", startedAt: new Date() };
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
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
  const row = await prisma.checkoutChatRequest.findFirstOrThrow();
  assert.equal(row.status, "unknown"); assert.equal(row.responseHash, null);
  assert.equal(await prisma.checkoutChatExchange.count(), 1);
  assert.equal((await repo.getSession("store", "session"))?.chatHistory.length, 2);
  await assert.rejects(service.run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED"));
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
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, completeFixture), code("CHAT_MESSAGE_RECONCILIATION_REQUIRED", 503));
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
  await assert.rejects(new CheckoutChatRequestService(broken).run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_ALREADY_COMPLETED", 409));
  assert.equal((await prisma.checkoutChatRequest.findFirstOrThrow()).status, "completed");
  await assert.rejects(service.run(input(), noPreflight, async (request, claim) => { effects++; return completeFixture(request, claim); }), code("CHAT_MESSAGE_ALREADY_COMPLETED"));
  assert.equal(effects, 1);
});

integration("recovery reads completed and rejected receipts without replay or enabling recovery", async () => {
  await seed();
  await service.run(input(), noPreflight, completeFixture);
  const completedReceipt = await service.reconcile(input() as any);
  assert.deepEqual(completedReceipt, { chat_request: { message_id: input().message_id, status: "completed", next_action: "refresh_session" } });
  const rejected = input("message_00000002");
  await assert.rejects(service.run(rejected, async () => { throw new Error("quota"); }, async () => assert.fail("no work")));
  assert.equal((await service.reconcile(rejected as any)).chat_request.status, "rejected");
  assert.equal(await prisma.checkoutChatResolution.count(), 0); assert.equal(await prisma.checkoutChatExchange.count(), 1);
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
  const proof = await prisma.checkoutChatExchange.findFirstOrThrow();
  assert.ok(session?.chatHistory.every(turn => turn.chatRequestId === proof.requestId));
  assert.equal(session?.chatHistory[1].text, result.message);
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
