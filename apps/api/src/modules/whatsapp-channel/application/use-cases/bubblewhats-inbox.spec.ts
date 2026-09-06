import "reflect-metadata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { AcceptBubbleWhatsWebhookUseCase } from "./accept-bubblewhats-webhook.use-case.js";
import { HandleIncomingMessageUseCase } from "./handle-incoming-message.use-case.js";
import { SendWhatsAppResponseUseCase } from "./send-whatsapp-response.use-case.js";
import { RouteToSessionUseCase } from "./route-to-session.use-case.js";
import { WhatsAppWebhookWorker } from "../services/whatsapp-webhook-worker.service.js";
import { WhatsAppWebhookController } from "../../presentation/http/whatsapp-webhook.controller.js";
import { WhatsAppConfigController } from "../../presentation/http/whatsapp-config.controller.js";
import { MultiProviderSenderAdapter } from "../../whatsapp-channel.module.js";
import { PrismaWhatsAppConfigRepository } from "../../infrastructure/repositories/prisma-whatsapp-config.repository.js";
import { BubbleWhatsSenderAdapter } from "../../infrastructure/adapters/bubblewhats-sender.adapter.js";
import type { WhatsAppInboxClaim, WhatsAppInboxEvent } from "../../domain/ports/whatsapp-webhook-inbox.port.js";

const config = () => ({
  id: "config-a", merchantId: "merchant-a", deviceId: "device-a", enabled: true,
  provider: "BUBBLEWHATS", webhookSecret: "test-secret-for-bubblewhats", credentials: {},
  status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(),
});
const message = () => ({
  id: "message-1", deviceID: "device-a", fromNumber: "5511999999999", body: "oi",
  isGroup: false, timestamp: 1_750_000_000, messageType: "text",
});
const statusMessage = (id: string, status = 3) => ({
  key: { id, remoteJid: "5511999999999@s.whatsapp.net", fromMe: true }, update: { status },
});

function setup(current: any = config(), accept?: (events: WhatsAppInboxEvent[]) => Promise<void>) {
  const batches: WhatsAppInboxEvent[][] = [];
  const repo = { findByDeviceId: async () => current };
  const inbox = { accept: accept ?? (async (events: WhatsAppInboxEvent[]) => { batches.push(events); }) };
  return { useCase: new AcceptBubbleWhatsWebhookUseCase(repo as any, inbox as any), batches };
}

describe("BubbleWhats authenticated durable acceptance", () => {
  it("fails closed for missing configuration, wrong provider, disabled channel and missing configured secret", async () => {
    for (const current of [null, { ...config(), provider: "TWILIO" }]) {
      await assert.rejects(setup(current).useCase.message(config().webhookSecret, message()), UnauthorizedException);
    }
    for (const current of [{ ...config(), enabled: false }, { ...config(), webhookSecret: undefined }, { ...config(), webhookSecret: "  " }]) {
      const { useCase, batches } = setup(current);
      await assert.rejects(useCase.message(undefined, message()), ServiceUnavailableException);
      await assert.rejects(useCase.status(undefined, { deviceID: "device-a", messages: [statusMessage("one")] }), ServiceUnavailableException);
      assert.equal(batches.length, 0);
    }
  });

  it("requires a valid secret even for group and self messages and status callbacks", async () => {
    for (const secret of [undefined, "", "wrong"]) {
      const { useCase, batches } = setup();
      await assert.rejects(useCase.message(secret, { ...message(), isGroup: true }), UnauthorizedException);
      await assert.rejects(useCase.message(secret, { ...message(), messageContext: { key: { fromMe: true } } }), UnauthorizedException);
      await assert.rejects(useCase.status(secret, { deviceID: "device-a", messages: [statusMessage("one")] }), UnauthorizedException);
      assert.equal(batches.length, 0);
    }
  });

  it("does not resolve the HTTP controller's acknowledgement until inbox persistence commits", async () => {
    let commit!: () => void;
    const pendingCommit = new Promise<void>((resolve) => { commit = resolve; });
    const { useCase } = setup(config(), async () => pendingCommit);
    const controller = new WhatsAppWebhookController({} as any, {} as any, useCase, {} as any);
    let acknowledged = false;
    const call = controller.receiveBubbleWhatsMessage(config().webhookSecret, message()).then((result) => {
      acknowledged = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(acknowledged, false);
    commit();
    assert.deepEqual(await call, { received: true });
  });

  it("surfaces storage failure as retryable 503 and ID/body collision as 409", async () => {
    const fail = setup(config(), async () => { throw new Error("db unavailable"); });
    await assert.rejects(fail.useCase.message(config().webhookSecret, message()), ServiceUnavailableException);
    await assert.rejects(fail.useCase.status(config().webhookSecret, { deviceID: "device-a", messages: [statusMessage("one")] }), ServiceUnavailableException);
    const conflict = setup(config(), async () => { throw new ConflictException("webhook_event_payload_conflict"); });
    await assert.rejects(conflict.useCase.message(config().webhookSecret, message()), ConflictException);
  });

  it("rejects malformed payloads and missing stable IDs without any inbox writes", async () => {
    const { useCase, batches } = setup();
    for (const payload of [null, {}, { ...message(), id: "" }, { ...message(), timestamp: NaN }, { ...message(), fromNumber: "victim" }]) {
      await assert.rejects(useCase.message(config().webhookSecret, payload), BadRequestException);
    }
    for (const messages of [[], [statusMessage("", 3)], [statusMessage("one", 999)], [statusMessage("one"), {}]]) {
      await assert.rejects(useCase.status(config().webhookSecret, { deviceID: "device-a", messages }), BadRequestException);
    }
    assert.equal(batches.length, 0);
  });

  it("deduplicates normalized status transitions independently of batch order and strips untrusted tenant", async () => {
    const { useCase, batches } = setup();
    await useCase.status(config().webhookSecret, { deviceID: "device-a", messages: [statusMessage("one"), statusMessage("two")] });
    await useCase.status(config().webhookSecret, { deviceID: "device-a", messages: [statusMessage("two"), statusMessage("one")] });
    assert.deepEqual(batches[0].map((event) => event.dedupKey), batches[1].map((event) => event.dedupKey).reverse());
    await useCase.message(config().webhookSecret, { ...message(), merchantId: "attacker", isGroup: true });
    assert.equal(batches[2][0].merchantId, "merchant-a");
    assert.equal(batches[2][0].payload.merchantId, "merchant-a");
    assert.equal((batches[2][0].payload as any).ignored, true);
  });

  it("rejects ambiguous device mappings and activation without a configured shared secret", async () => {
    const repo = new PrismaWhatsAppConfigRepository({ whatsAppChannelConfig: { findMany: async () => [config(), config()] } } as any);
    await assert.rejects(repo.findByDeviceId("device-a"), ServiceUnavailableException);
    let writes = 0;
    const controller = new WhatsAppConfigController({} as any, {
      findByMerchantId: async () => ({ ...config(), webhookSecret: undefined }),
      upsert: async () => { writes++; },
    } as any);
    await assert.rejects(controller.toggle("merchant-a", { enabled: true }), ServiceUnavailableException);
    assert.equal(writes, 0);
  });
});

async function claim(): Promise<WhatsAppInboxClaim> {
  const { useCase, batches } = setup();
  await useCase.message(config().webhookSecret, message());
  return { ...batches[0][0], id: "inbox-1", leaseToken: "lease-1", attempts: 1 };
}

describe("BubbleWhats worker failure propagation", () => {
  it("revalidates merchant/config/provider/enablement/secret before calling the pipeline", async () => {
    for (const current of [null, { ...config(), id: "replaced" }, { ...config(), merchantId: "other" },
      { ...config(), deviceId: "different" }, { ...config(), provider: "TWILIO" },
      { ...config(), enabled: false }, { ...config(), webhookSecret: "" }]) {
      let next: WhatsAppInboxClaim | null = await claim();
      const failures: string[] = [];
      const inbox = {
        claimNext: async () => { const result = next; next = null; return result; },
        fail: async (_claim: unknown, code: string) => { failures.push(code); return true; },
        complete: async () => { assert.fail("must not complete"); },
      };
      const worker = new WhatsAppWebhookWorker(inbox as any, { findByDeviceId: async () => current } as any,
        { execute: async () => { assert.fail("must not process invalidated config"); } } as any, {} as any);
      await worker.drain();
      assert.deepEqual(failures, ["whatsapp_channel_changed_or_disabled"]);
    }
  });

  it("the actual incoming/send pipeline leaves a failed provider send retryable and sends no fallback", async () => {
    let next: WhatsAppInboxClaim | null = await claim();
    let failed = 0;
    let sends = 0;
    let completed = 0;
    const incoming = new HandleIncomingMessageUseCase({} as any, {
      execute: async () => ({ whatsappSession: { id: "session-1", checkoutSessionId: "checkout-1", currentOptions: [], previousOptions: [], currentPage: 0 } }),
    } as any, new SendWhatsAppResponseUseCase({ sendText: async () => { sends++; return { status: "failed", messageId: "" }; } }),
    { updateMenuState: async () => {} } as any);
    const inbox = {
      claimNext: async () => { const result = next; next = null; return result; },
      fail: async () => { failed++; return true; }, complete: async () => { completed++; return true; },
    };
    const worker = new WhatsAppWebhookWorker(inbox as any, { findByDeviceId: async () => config() } as any, incoming, {} as any);
    await worker.drain();
    assert.deepEqual({ failed, sends, completed }, { failed: 1, sends: 1, completed: 0 });
  });

  it("propagates menu persistence failure before sending and checkout creation failure before session creation", async () => {
    let sends = 0;
    const incoming = new HandleIncomingMessageUseCase({} as any, {
      execute: async () => ({ whatsappSession: { id: "session", checkoutSessionId: "checkout", currentOptions: [], previousOptions: [], currentPage: 0 } }),
    } as any, { execute: async () => { sends++; } } as any,
    { updateMenuState: async () => { throw new Error("menu failed"); } } as any);
    await assert.rejects(incoming.execute((await claim()).payload as any), /menu failed/);
    assert.equal(sends, 0);
    const route = new RouteToSessionUseCase({
      findActiveByPhone: async () => null,
      create: async () => { assert.fail("must not persist phantom session"); },
    } as any, {
      buyerIdentity: { findUnique: async () => ({ globalUserId: "buyer" }) },
      checkoutSession: { findFirst: async () => null, create: async () => { throw new Error("checkout failed"); } },
    } as any);
    await assert.rejects(route.execute({ merchantId: "merchant-a", deviceId: "device-a", fromNumber: "5511999999999" }), /checkout failed/);
  });

  it("routes an authenticated BubbleWhats response only to its provider", async () => {
    const sender = new MultiProviderSenderAdapter({ sendText: async () => ({ status: "sent", messageId: "sent-1" }) } as any,
      { sendText: async () => { assert.fail("must not attempt a different provider"); } } as any);
    assert.equal((await sender.sendText({ provider: "BUBBLEWHATS" })).messageId, "sent-1");
  });

  it("the BubbleWhats adapter refuses redirects, has a timeout and never logs echoed response or network secrets", async () => {
    const previousUrl = process.env.BUBBLEWHATS_API_URL;
    const previousToken = process.env.BUBBLEWHATS_TOKEN;
    const previousFetch = globalThis.fetch;
    const log: string[] = [];
    const requests: RequestInit[] = [];
    process.env.BUBBLEWHATS_API_URL = "https://bubblewhats.example.invalid";
    process.env.BUBBLEWHATS_TOKEN = "secret-echo-must-not-appear";
    try {
      const adapter = new BubbleWhatsSenderAdapter();
      (adapter as any).logger = { log: (value: string) => log.push(value), error: (value: string) => log.push(value) };
      globalThis.fetch = async (_url, init) => {
        requests.push(init!);
        return new Response("secret-echo-must-not-appear buyer-message", { status: 502 });
      };
      assert.equal((await adapter.sendText({ toNumber: "5511999999999", deviceId: "device", text: "buyer-message" })).status, "failed");
      globalThis.fetch = async () => { throw new Error("secret-echo-must-not-appear buyer-message"); };
      assert.equal((await adapter.sendText({ toNumber: "5511999999999", deviceId: "device", text: "buyer-message" })).status, "failed");
      assert.equal(requests[0].redirect, "error");
      assert.ok(requests[0].signal instanceof AbortSignal);
      assert.equal(requests[0].signal.aborted, false);
      assert.ok(log.some((value) => value.includes("status=502")));
      assert.ok(log.every((value) => !/secret-echo|buyer-message|5511999999999/.test(value)));
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.BUBBLEWHATS_API_URL;
      else process.env.BUBBLEWHATS_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.BUBBLEWHATS_TOKEN;
      else process.env.BUBBLEWHATS_TOKEN = previousToken;
    }
  });

  it("coalesces concurrent drain calls and waits for an active attempt at shutdown", async () => {
    let next: WhatsAppInboxClaim | null = await claim();
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let completed = 0;
    const worker = new WhatsAppWebhookWorker({
      claimNext: async () => { const result = next; next = null; return result; },
      complete: async () => { completed++; return true; },
    } as any, { findByDeviceId: async () => config() } as any,
    { execute: async () => { entered(); await gate; } } as any, {} as any);
    const first = worker.drain();
    assert.equal(worker.drain(), first);
    await enteredPromise;
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => { stopped = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    release();
    await shutdown;
    assert.equal(completed, 1);
    await worker.drain();
    assert.equal(completed, 1);
  });
});
