import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { WhatsAppSessionEntity, WhatsAppSessionRepository } from "../../domain/ports/whatsapp-session-repository.port.js";
import { RouteToSessionUseCase } from "./route-to-session.use-case.js";

type Fields = Record<string, unknown>;
const MERCHANT = "merchant-whatsapp-anchor-synthetic";
const PHONE = "5511999990000";
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function fields(value: unknown): Fields {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Fields;
}

function existingSession(overrides: Partial<WhatsAppSessionEntity> = {}): WhatsAppSessionEntity {
  return { id: "wa-existing-synthetic", merchantId: MERCHANT, buyerPhone: PHONE, checkoutSessionId: "checkout-existing-synthetic",
    deviceId: "device-synthetic", currentOptions: [], previousOptions: [], currentPage: 0,
    lastActivityAt: new Date(), status: "active", createdAt: new Date(), ...overrides };
}

function harness(options: { active?: WhatsAppSessionEntity; buyerExists?: boolean;
  fail?: "anchor" | "create" | "commit"; meta?: boolean; merchantId?: string } = {}) {
  const calls: string[] = [];
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const checkoutCreates: Fields[] = [];
  const checkoutCommitted: Fields[] = [];
  const waCreates: Array<Omit<WhatsAppSessionEntity, "id" | "createdAt">> = [];
  let transactionActive = false;
  const tx = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      calls.push("tx:anchor");
      assert.equal(transactionActive, true);
      statements.push({ text: parts.join("?"), values });
      if (options.fail === "anchor") throw new Error("synthetic_anchor_failed");
      return [];
    },
    checkoutSession: {
      async create(input: unknown) {
        calls.push("tx:create");
        assert.equal(transactionActive, true);
        checkoutCreates.push(structuredClone(fields(fields(input).data)));
        if (options.fail === "create") throw new Error("synthetic_create_failed");
        return { id: "checkout-row-synthetic", ...fields(fields(input).data) };
      },
    },
  };
  const prisma = {
    async $transaction<T>(work: (client: typeof tx) => Promise<T>): Promise<T> {
      calls.push("tx:begin");
      assert.equal(transactionActive, false);
      transactionActive = true;
      try {
        const result = await work(tx);
        if (options.fail === "commit") throw new Error("synthetic_commit_unknown");
        checkoutCommitted.push(...structuredClone(checkoutCreates));
        calls.push("tx:commit");
        return result;
      } catch (error) {
        calls.push("tx:rollback");
        throw error;
      } finally { transactionActive = false; }
    },
    buyerIdentity: {
      async findUnique() { calls.push("buyer:read"); return options.buyerExists ? { globalUserId: "buyer-existing-synthetic" } : null; },
      async upsert(input: unknown) {
        calls.push("buyer:upsert");
        const value = fields(input), create = fields(value.create);
        assert.equal(create.merchantId, options.merchantId ?? MERCHANT);
        assert.deepEqual(fields(value.where).merchantId_identityKey, { merchantId: create.merchantId, identityKey: create.identityKey });
        assert.deepEqual(value.update, {}, "renewal_must_not_overwrite_an_existing_buyer");
        return create;
      },
    },
    checkoutSession: {
      async findFirst() {
        calls.push("buyer:hydrate");
        return { customer: { fullName: "Synthetic Buyer", email: "synthetic@example.invalid", cpf: "synthetic", address: { city: "Synthetic" } } };
      },
      async create(input: unknown) {
        calls.push("root:create");
        checkoutCreates.push(structuredClone(fields(fields(input).data)));
        checkoutCommitted.push(structuredClone(fields(fields(input).data)));
        return { id: "checkout-row-synthetic", ...fields(fields(input).data) };
      },
    },
  };
  const sessions: WhatsAppSessionRepository = {
    async findActiveByPhone(merchantId, phone, deviceId) {
      calls.push("wa:read");
      assert.equal(merchantId, options.merchantId ?? MERCHANT);
      assert.equal(phone, PHONE);
      assert.equal(deviceId, options.meta ? "META_CLOUD:synthetic" : "device-synthetic");
      return options.active ?? null;
    },
    async create(data) {
      calls.push("wa:create");
      assert.equal(transactionActive, false, "wa_publication_must_follow_checkout_commit");
      waCreates.push(structuredClone(data));
      return { id: "wa-created-synthetic", createdAt: new Date(), ...data };
    },
    async update() { calls.push("wa:activity"); return options.active ?? existingSession(); },
    async expire() { calls.push("wa:expire"); },
    async updateMenuState() {},
    async setPostSaleContext() {},
    async clearPostSaleContext() {},
  };
  const useCase = new RouteToSessionUseCase(sessions, prisma as unknown as PrismaClient);
  return { calls, statements, checkoutCreates, checkoutCommitted, waCreates,
    run: () => useCase.execute({ merchantId: options.merchantId ?? MERCHANT,
      deviceId: options.meta ? "META_CLOUD:synthetic" : "device-synthetic", fromNumber: "+55 (11) 99999-0000", fromAlias: "Synthetic Alias" }) };
}

function assertAnchoredCreation(subject: ReturnType<typeof harness>, merchantId = MERCHANT) {
  assert.equal(subject.calls.includes("root:create"), false);
  assert.equal(subject.calls.filter(call => call === "tx:begin").length, 1);
  assert.equal(subject.calls.filter(call => call === "tx:anchor").length, 1);
  assert.equal(subject.calls.filter(call => call === "tx:create").length, 1);
  assert.ok(subject.calls.indexOf("tx:begin") < subject.calls.indexOf("tx:anchor"));
  assert.ok(subject.calls.indexOf("tx:anchor") < subject.calls.indexOf("tx:create"));
  const [create] = subject.checkoutCreates;
  assert.equal(typeof create.sessionId, "string");
  assert.match(create.sessionId as string, UUID_V4);
  assert.equal(typeof create.conversationId, "string");
  assert.match(create.conversationId as string, UUID_V4);
  assert.notEqual(create.sessionId, create.conversationId);
  assert.equal(create.merchantId, merchantId);
  assert.equal(subject.statements.length, 1);
  assert.match(subject.statements[0].text, /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*\?\s*,\s*0\s*\)\s*\)/i);
  assert.deepEqual(subject.statements[0].values, [JSON.stringify(["checkout-session", merchantId, create.sessionId])]);
  assert.doesNotMatch(subject.statements[0].text, /FOR\s+UPDATE|storefront_carts/i);
}

test("new WhatsApp checkout is created only after its tenant/UUID anchor in the same transaction, before WA publication", async () => {
  const subject = harness();
  const result = await subject.run();
  assertAnchoredCreation(subject);
  assert.ok(subject.calls.indexOf("tx:create") < subject.calls.indexOf("tx:commit"));
  assert.ok(subject.calls.indexOf("tx:commit") < subject.calls.indexOf("wa:create"));
  assert.equal(result.isNew, true);
  assert.equal(result.checkoutSessionId, subject.checkoutCreates[0].sessionId);
  assert.equal(result.whatsappSession.checkoutSessionId, result.checkoutSessionId);
  assert.equal(subject.checkoutCommitted.length, 1);
  assert.deepEqual(subject.checkoutCreates[0].cart, { items: [], total: 0, currency: "BRL" });
  assert.equal(subject.checkoutCreates[0].globalUserId, result.buyerData.globalUserId);
  assert.equal(fields(subject.checkoutCreates[0].customer).phone, PHONE);
  assert.equal(fields(subject.checkoutCreates[0].customer).phone_verified, true);
});

test("returning buyer hydration and tenant scope survive anchored checkout creation", async () => {
  const subject = harness({ buyerExists: true, merchantId: "merchant|other:same-scope" });
  const result = await subject.run();
  assertAnchoredCreation(subject, "merchant|other:same-scope");
  assert.equal(subject.calls.includes("buyer:upsert"), false);
  assert.equal(subject.checkoutCreates[0].globalUserId, "buyer-existing-synthetic");
  assert.equal(result.buyerData.fullName, "Synthetic Buyer");
  assert.equal(fields(subject.checkoutCreates[0].customer).email, "synthetic@example.invalid");
});

for (const failure of ["anchor", "create", "commit"] as const) {
  test(`${failure} failure is propagated without retry or publishing a WhatsApp checkout reference`, async () => {
    const subject = harness({ fail: failure });
    await assert.rejects(subject.run(), { message: failure === "commit" ? "synthetic_commit_unknown" : `synthetic_${failure}_failed` });
    assert.equal(subject.calls.filter(call => call === "tx:begin").length, 1);
    assert.equal(subject.calls.filter(call => call === "tx:anchor").length, 1);
    assert.equal(subject.calls.filter(call => call === "tx:create").length, failure === "anchor" ? 0 : 1);
    assert.equal(subject.calls.includes("root:create"), false);
    assert.equal(subject.calls.includes("wa:create"), false);
    assert.equal(subject.calls.includes("tx:commit"), false);
    assert.equal(subject.calls.at(-1), "tx:rollback");
    assert.deepEqual(subject.checkoutCommitted, []);
    assert.deepEqual(subject.waCreates, []);
    // Buyer registration precedes checkout creation today; this test does not
    // pretend that registration, checkout and the WA repository share one TX.
  });
}

test("a live existing WA session only renews activity and never creates or locks a checkout", async () => {
  const active = existingSession();
  const subject = harness({ active });
  const result = await subject.run();
  assert.equal(result.isNew, false);
  assert.equal(result.checkoutSessionId, active.checkoutSessionId);
  assert.equal(subject.calls.includes("wa:activity"), true);
  assert.equal(subject.calls.some(call => call.startsWith("tx:")), false);
  assert.deepEqual(subject.checkoutCreates, []);
  assert.deepEqual(subject.statements, []);
});

test("an expired legacy WA session keeps expiry behavior then creates one freshly anchored UUID checkout", async () => {
  const subject = harness({ active: existingSession({ lastActivityAt: new Date(Date.now() - 25 * 3600_000) }) });
  const result = await subject.run();
  assert.equal(result.isNew, true);
  assertAnchoredCreation(subject);
  assert.ok(subject.calls.indexOf("wa:expire") < subject.calls.indexOf("tx:begin"));
  assert.notEqual(result.checkoutSessionId, "checkout-existing-synthetic");
});

test("Meta store conversations retain their existing path without checkout creation or anchor", async () => {
  const subject = harness({ meta: true, buyerExists: true });
  const result = await subject.run();
  assert.equal(result.isNew, true);
  assert.equal(result.checkoutSessionId, undefined);
  assert.equal(result.whatsappSession.checkoutSessionId, undefined);
  assert.equal(result.whatsappSession.conversationState?.stage, "store");
  assert.equal(result.buyerData.email, undefined);
  assert.equal(subject.calls.some(call => call.startsWith("tx:")), false);
  assert.deepEqual(subject.checkoutCreates, []);
  assert.deepEqual(subject.statements, []);
});
