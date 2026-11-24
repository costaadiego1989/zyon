import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { PasswordHasher } from "../src/modules/auth/domain/services/password-hasher.service.js";
import type { WhatsAppConversationState, StoreUiAction } from "../src/modules/whatsapp-channel/domain/ui/meta-ui.types.js";
import { toCheckoutSession } from "../src/modules/checkout/domain/services/checkout-session-projection.js";

export interface NativeJourneyCase {
  merchantId: string; configId: string; deviceId: string; phoneNumberId: string; phone: string;
  productId: string; variantId: string; professionalId: string; buyerId?: string;
  mode: "products" | "services";
}
/** Private owned-test options already admitted by createServiceTestRuntime.
 * Original callers retain their identical captured-numeric-voice defaults. */
export async function createNativeServiceJourneyFixture(options: {
  voiceTranscripts?: Record<string, string>; modelScript?: unknown[]; storefrontRoutingProfile?: "structured"; bookingAwaitTrace?: true; localModelFailure?: true; native18HttpFailures?: true; serviceReleaseFixture?: "matching" | "missing";
} = {}) {
  assert.ok(options.serviceReleaseFixture === undefined || ["matching", "missing"].includes(options.serviceReleaseFixture), "native_release_fixture_invalid");
  const runtime = await createServiceTestRuntime({ local: true, ...(options.serviceReleaseFixture === undefined ? {} : { serviceReleaseFixture: options.serviceReleaseFixture }), metaCapabilitiesFixture: "owned-empty-v1", recoveryTemplateMonitorFixture: "manual-only-v1",
    ...(options.bookingAwaitTrace === true ? { bookingAwaitTrace: "native18-v1" } : {}),
    ...(options.localModelFailure === true ? { localModelFailureFixture: "owned-503-v1" } : {}),
    ...(options.native18HttpFailures === true ? { native18HttpFailures: "closed-failures-v1" } : {}),
    whatsapp: { voiceTranscripts: options.voiceTranscripts ?? { "1001": "1", "1002": "1" } },
    ...(options.modelScript ? { storefrontQueryModel: true, modelScript: options.modelScript } : {}),
    ...(options.storefrontRoutingProfile === undefined ? {} : { storefrontRoutingProfile: options.storefrontRoutingProfile }) });
  let prisma: PrismaClient | undefined, redis: Redis | undefined;
  try {
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const db = prisma;
    redis = new Redis(runtime.redis.url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null,
      commandTimeout: 5000, connectTimeout: 5000, enableOfflineQueue: false });
    await redis.connect(); const cache = redis, slots = new RedisServiceSlots(cache);
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    assert.equal(await cache.get("aacp:synthetic:run"), runtime.redis.runId);
    assert.equal(runtime.evidence().canonicalAppModule, true);
    assert.equal(runtime.evidence().authOverrides, false); assert.equal(runtime.evidence().repositoryOverrides, false);
    const password = "SyntheticNativeBuyer123!", hash = await new PasswordHasher().hash(password);
    let serial = 0;
    const request = async (path: string, body: unknown, headers: Record<string, string> = {}, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    async function make(suffix: string, options: { mode?: "products" | "services"; guest?: boolean; hold?: boolean; online?: boolean } = {}): Promise<NativeJourneyCase> {
      const index = ++serial, merchantId = "t46-" + suffix, configId = merchantId + "-config", phone = "5511998" + String(index).padStart(6, "0"),
        phoneNumberId = "900046" + String(index).padStart(6, "0"), mode = options.mode ?? "services";
      await db.merchant.create({ data: { id: merchantId, name: "Synthetic " + suffix, businessMode: mode, businessModeSelectedAt: new Date(),
        plan: "STORE_ONLY", storeSettings: { company: { description: "Empresa sintética de atendimento." } } } });
      await db.merchantBillingSubscription.create({ data: { merchantId, planKey: "growth", status: "active" } });
      await db.merchantRule.create({ data: { merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0, allowFreeShipping: false,
        allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false,
        autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0,
        offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
      await db.whatsAppChannelConfig.create({ data: { id: configId, merchantId, provider: "META_CLOUD", enabled: true, status: "ACTIVE",
        deviceId: "META_CLOUD:" + configId, credentials: { phoneNumberId, wabaId: "900046999", accessToken: "synthetic-not-a-provider-secret" } } });
      if (options.online) await db.merchantPaymentConnection.create({ data: { merchantId, provider: "asaas", environment: "sandbox",
        status: "active", chargesEnabled: true, payoutsEnabled: false, externalAccountId: "synthetic-no-external-account" } });
      if (mode === "services") await db.serviceBusinessPolicy.create({ data: { merchantId, admissionsEnabled: true, holdEnabled: !!options.hold,
        holdMinutes: options.hold ? 4 : null, paymentMode: options.online ? "online" : "at_attendance", version: 1, configuredAt: new Date() } });
      const productId = merchantId + "-offer", variantId = productId + "-variant", professionalId = merchantId + "-professional";
      await db.product.create({ data: { id: productId, merchantId, name: "Consulta " + suffix, type: mode === "services" ? "service" : "physical",
        isActive: true, ...(mode === "services" ? { metadata: { serviceSchedule: { durationMinutes: 30, timeZone: "America/Sao_Paulo", slots: [] } } } : {}),
        variants: { create: { id: variantId, sku: "NATIVE-" + suffix, isActive: true, stock: { create: { quantity: 10 } }, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } } });
      if (mode === "services") {
        await db.serviceProfessional.create({ data: { id: professionalId, merchantId, publicName: "Profissional " + suffix,
          timeZone: "America/Sao_Paulo", isActive: true, isPublished: true } });
        await db.professionalService.create({ data: { merchantId, professionalId, productId } });
        await db.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId, professionalId,
          weekday, startMinute: 600, endMinute: 720, timeZone: "America/Sao_Paulo" })) });
      }
      let buyerId: string | undefined;
      if (!options.guest) {
        const buyer = await db.buyerAccount.create({ data: { globalUserId: merchantId + "-buyer", email: suffix + "@native-buyer.example.test",
          passwordHash: hash, displayName: "Cliente Sintético", phone } }); buyerId = buyer.globalUserId;
        const login = await request("/buyer/login", { email: buyer.email, password }); assert.equal(login.status, 201);
        // Exercise the actual account writer in the served process. Its PII key
        // stays private there; the test never substitutes a phone authority.
        const profile = await request("/buyer/me/profile", { phone }, { authorization: "Bearer " + login.body.accessToken }, "PATCH");
        assert.equal(profile.status, 200);
        const stored = await db.buyerAccount.findUniqueOrThrow({ where: { globalUserId: buyerId } });
        assert.ok(stored.phone?.startsWith("pii_v1:")); assert.ok(stored.phoneLookupHash);
      }
      return { merchantId, configId, deviceId: "META_CLOUD:" + configId, phoneNumberId, phone, productId, variantId, professionalId, buyerId, mode };
    }
    const secondBuyer = async (c: NativeJourneyCase): Promise<NativeJourneyCase> => {
      const suffix = "second-" + (++serial), phone = "5511998" + String(serial).padStart(6, "0");
      const buyer = await db.buyerAccount.create({ data: { email: suffix + "@native-buyer.example.test", passwordHash: hash,
        displayName: "Segundo Cliente", phone } });
      const login = await request("/buyer/login", { email: buyer.email, password }); assert.equal(login.status, 201);
      assert.equal((await request("/buyer/me/profile", { phone }, { authorization: "Bearer " + login.body.accessToken }, "PATCH")).status, 200);
      assert.ok((await db.buyerAccount.findUniqueOrThrow({ where: { globalUserId: buyer.globalUserId } })).phone?.startsWith("pii_v1:"));
      if (options.native18HttpFailures === true) {
        assert.equal(c.phoneNumberId, "900046000015", "native18_second_buyer_known_config_required");
        assert.equal(c.phone, "5511998000015", "native18_second_buyer_known_first_recipient_required");
        assert.equal(phone, "5511998000016", "native18_second_buyer_known_second_recipient_required");
      }
      return { ...c, phone, buyerId: buyer.globalUserId };
    };
    const read = (c: NativeJourneyCase) => db.whatsAppSession.findFirstOrThrow({ where: { merchantId: c.merchantId, buyerPhone: c.phone,
      deviceId: c.deviceId, status: "active" } });
    const state = async (c: NativeJourneyCase) => (await read(c)).conversationState as unknown as WhatsAppConversationState;
    const payloads = new Map<string, unknown>();
    const wire = (c: NativeJourneyCase, text: string, options: { interactiveId?: string; audio?: boolean; eventId?: string } = {}) => {
      const eventId = options.eventId ?? "t46-inbound-" + randomUUID();
      if (payloads.has(eventId)) return { eventId, payload: structuredClone(payloads.get(eventId)) };
      const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: c.phoneNumberId }, messages: [{
        id: eventId, from: c.phone, timestamp: String(Math.floor(Date.now() / 1000)),
        type: options.audio ? "audio" : options.interactiveId ? "interactive" : "text",
        ...(options.audio ? { audio: { id: text, mime_type: "audio/ogg" } } : options.interactiveId
          ? { interactive: { list_reply: { id: options.interactiveId, title: text } } } : { text: { body: text } }),
      }] } }] }] }; payloads.set(eventId, structuredClone(payload)); return { eventId, payload };
    };
    const wait = async <T>(work: () => Promise<T | undefined | null | false>, label: string): Promise<T> => {
      const until = Date.now() + 15_000;
      do { const result = await work(); if (result) return result; await new Promise(done => setTimeout(done, 20)); } while (Date.now() < until);
      assert.fail(label);
    };
    const post = async (event: ReturnType<typeof wire>, valid = true) => {
      const body = JSON.stringify(event.payload);
      const response = await request("/webhooks/whatsapp/meta", event.payload, { "x-hub-signature-256": valid ? runtime.whatsapp.signature(body) : "sha256=" + "0".repeat(64) });
      assert.equal(response.status, valid ? 200 : 401);
      if (!valid) return;
      let lastInboxObservation: { status: string; attempts: number; availableAt: string; leaseExpiresAt: string | null; processedAt: string | null; hasError: boolean; phase: string } | null = null;
      const inbox = await wait(async () => { const row = await db.whatsAppWebhookInbox.findFirst({ where: { eventId: event.eventId } });
        const phase = row?.responseState && typeof row.responseState === "object" && !Array.isArray(row.responseState) ? row.responseState.phase : undefined;
        if (row) lastInboxObservation = { status: ["pending", "processing", "processed", "retry", "blocked", "dead"].includes(row.status) ? row.status : "unknown",
          attempts: row.attempts, availableAt: row.availableAt.toISOString(), leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
          processedAt: row.processedAt?.toISOString() ?? null, hasError: row.lastError !== null,
          phase: typeof phase === "string" && ["authority", "generating", "prepared", "dispatching", "complete"].includes(phase) ? phase : "unknown" };
        return row && ["processed", "blocked", "dead"].includes(row.status) ? row : undefined; }, "native_signed_inbox_not_settled").catch(error => {
          console.error("native_signed_inbox_failure_observation", lastInboxObservation);
          if (runtime.bookingAwaitTrace) console.error("native_booking_await_failure", runtime.bookingAwaitTrace.snapshot());
          throw error;
        });
      return inbox;
    };
    async function message(c: NativeJourneyCase, text: string, options: Parameters<typeof wire>[2] = {}) {
      const event = wire(c, text, options), inbox = await post(event); assert.ok(inbox);
      assert.equal(inbox.status, "processed", "native_current_turn_must_process_without_retry");
      return { event, inbox, state: await state(c) };
    }
    const choices = async (c: NativeJourneyCase) => Object.entries((await state(c)).selections ?? {});
    async function control(c: NativeJourneyCase, predicate: (action: StoreUiAction) => boolean) {
      const matches = (await choices(c)).filter(([, action]) => predicate(action));
      assert.equal(matches.length, 1, "one actual current native control required"); return { id: matches[0]![0], action: matches[0]![1] };
    }
    const operation = (action: StoreUiAction, name: string) => action.kind === "service_booking" && action.operation === name;
    const choose = async (c: NativeJourneyCase, name: string, extra: (action: any) => boolean = () => true) => {
      const picked = await control(c, action => operation(action, name) && extra(action));
      return message(c, "Escolha " + name, { interactiveId: picked.id });
    };
    async function review(c: NativeJourneyCase, options: { voice?: boolean; reopen?: boolean } = {}) {
      if (options.reopen !== false) await message(c, "/servicos");
      await choose(c, "offer", action => action.productId === c.productId && action.variantId === c.variantId);
      await choose(c, "professional", action => action.professionalId === c.professionalId);
      const dates = (await choices(c)).filter(([, action]) => operation(action, "date")); assert.ok(dates.length);
      await message(c, "Data", { interactiveId: dates[0]![0] });
      const current = await state(c), slotsInMenu = (current.numericSelections ?? []).filter(action => operation(action, "slot")); assert.ok(slotsInMenu.length);
      if (options.voice) { assert.ok(operation(current.numericSelections![0]!, "slot")); await message(c, "1001", { audio: true }); }
      else {
        const slotId = (slotsInMenu[0] as any).selection.slotId;
        await choose(c, "slot", action => action.selection.slotId === slotId);
      }
      const result = await state(c); assert.equal((result.view?.serviceBooking?.model as any)?.step, "review");
      return result;
    }
    const checkout = async (c: NativeJourneyCase) => {
      const session = await read(c); assert.ok(session.checkoutSessionId);
      return db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: session.checkoutSessionId } } });
    };
    const snapshot = async (c: NativeJourneyCase) => ({
      appointments: await db.serviceAppointment.findMany({ where: { merchantId: c.merchantId }, include: { payments: true }, orderBy: { id: "asc" } }),
      payments: await db.paymentIntent.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" } }),
      audits: await db.appointmentAudit.findMany({ where: { merchantId: c.merchantId }, orderBy: { commandId: "asc" } }),
      events: await db.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "service-booking" },
        select: { eventId: true, eventType: true, merchantId: true, correlationId: true, causationId: true, payload: true }, orderBy: { eventId: "asc" } }),
      orders: await db.completedOrder.count({ where: { merchantId: c.merchantId } }),
      inventory: await db.inventoryMovement.count({ where: { merchantId: c.merchantId } }),
    });
    const close = async () => { const errors: unknown[] = [];
      try { await cache.quit(); } catch (error) { cache.disconnect(); errors.push(error); }
      try { await db.$disconnect(); } catch (error) { errors.push(error); }
      try { await runtime.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "native_service_journey_cleanup_failed");
      assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
    };
    return { runtime, prisma: db, redis: cache, slots, make, secondBuyer, request, read, state, wire, post, message, wait, control, operation, choose, review, checkout, snapshot,
      canonicalCheckout: async (c: NativeJourneyCase) => toCheckoutSession(await checkout(c)), close };
  } catch (error) {
    const errors: unknown[] = [error]; try { redis?.disconnect(); } catch (failure) { errors.push(failure); }
    try { await prisma?.$disconnect(); } catch (failure) { errors.push(failure); }
    try { await runtime.close(); } catch (failure) { errors.push(failure); }
    throw errors.length === 1 ? error : new AggregateError(errors, "native_service_journey_setup_cleanup_failed");
  }
}
