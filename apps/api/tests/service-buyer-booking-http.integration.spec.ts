import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { composeOwnedDistServiceRelease } from "./service-release-dist-process.fixture.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { lockCheckoutSessionAnchor } from "../src/shared/persistence/checkout-session-lock.js";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";

// A real, privately shortened capability tests expiry without changing the
// public issuer's60s minimum, the DB clock, production guards or lock budgets.
test("T40 HTTP/SQL/Redis", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const runtime = await createServiceTestRuntime({ local: true, buyerBooking: true, serviceReleaseFixture: "matching" });
  let prisma: PrismaClient | undefined, redis: Redis | undefined;
  try {
    const releaseFixtureScope = composeOwnedDistServiceRelease("matching"); t.after(() => releaseFixtureScope.close());
    prisma = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } });
    const db = prisma;
    redis = new Redis(runtime.redis.url, { maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5000, commandTimeout: 5000 });
    const cache = redis;
    assert.deepEqual(await db.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    assert.equal(await cache.get("aacp:synthetic:run"), runtime.redis.runId);
    const evidence = runtime.evidence(); assert.equal(evidence.canonicalAppModule, true);
    assert.equal(evidence.authOverrides, false); assert.equal(evidence.repositoryOverrides, false); assert.equal(evidence.providerCalls, 0);
    const { PasswordHasher } = await import("../dist/modules/auth/domain/services/password-hasher.service.js");
    const password = "SyntheticBuyerPassword123!", passwordHash = await new PasswordHasher().hash(password);
    const request = async (path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") => {
      const response = await fetch(runtime.apiOrigin + path, { method, redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json", "x-correlation-id": randomUUID(), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    async function buyer(suffix: string) {
      const row = await db.buyerAccount.create({ data: { globalUserId: "buyer_" + randomUUID().replaceAll("-", ""),
        email: suffix + "@buyer-booking.example.test", passwordHash, displayName: "Synthetic " + suffix,
        phone: "5511999997711", cpf: "12345678909" } });
      const login = await request("/buyer/login", { email: row.email, password });
      assert.equal(login.status, 201, JSON.stringify(login)); assert.equal(login.body.globalUserId, row.globalUserId);
      return { row, token: login.body.accessToken as string };
    }
    const alice = await buyer("alice"), bob = await buyer("bob"), origin = "https://buyer-booking.example.test";
    async function context(suffix: string, holdEnabled = false, paymentMode: "at_attendance" | "online" = "at_attendance", ttlSeconds = 900) {
      const registered = await request("/auth/register", { merchant_name: "Synthetic " + suffix,
        email: suffix + "@buyer-booking.example.test", password: "SyntheticMerchantPassword123!", business_mode: "services" });
      assert.equal(registered.status, 201, JSON.stringify(registered));
      const merchantId = registered.body.merchant_id as string;
      await db.merchant.update({ where: { id: merchantId }, data: { plan: "STORE_ONLY" } });
      await db.merchantBillingSubscription.upsert({ where: { merchantId }, create: { merchantId, planKey: "starter", status: "active" }, update: { planKey: "starter", status: "active" } });
      await db.merchantRule.create({ data: { merchantId, maxDiscountPercent: 0, minimumMarginPercent: 0, allowFreeShipping: false,
        allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: false,
        autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0,
        offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
      const policy = await request("/merchants/me/service-business-policy", { expectedVersion: 0, holdEnabled,
        ...(holdEnabled ? { holdMinutes: 4 } : {}), paymentMode, admissionsEnabled: true }, { authorization: "Bearer " + registered.body.access_token }, "PUT");
      assert.equal(policy.status, 200, JSON.stringify(policy));
      const product = await db.product.create({ data: { merchantId, name: "Public consultation " + suffix, type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 20, slots: [] } }, variants: {
          create: { sku: "BOOK-" + suffix, isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      const professional = await db.serviceProfessional.create({ data: { merchantId, publicName: "Public professional " + suffix,
        timeZone: "America/Sao_Paulo", isActive: true, isPublished: true, publicProfile: { description: "Public biography", specialties: ["Consulting"], privateSecret: "not-public" } } });
      await db.professionalService.create({ data: { merchantId, professionalId: professional.id, productId: product.id } });
      await db.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId,
        professionalId: professional.id, weekday, startMinute: 600, endMinute: 720, timeZone: professional.timeZone })) });
      const conversation = await request("/storefront/conversations", { merchant_id: merchantId, buyer_access_token: alice.token }, { origin });
      assert.equal(conversation.status, 201, JSON.stringify(conversation));
      const cartRef = conversation.body.conversation_id as string;
      const issued = await runtime.buyerBooking.issue({ merchantId, body: { cart_ref: cartRef,
        conversation_token: conversation.body.conversation_token, allowed_origin: origin,
        scopes: ["checkout:start", "checkout:track", "appointments:confirm"], ttl_seconds: ttlSeconds } });
      assert.equal(issued.status, 201, JSON.stringify(issued));
      const claims = JSON.parse(Buffer.from(issued.body.embed_session_token.split(".")[0], "base64url").toString("utf8"));
      assert.equal(claims.storefrontCartRef, cartRef); assert.equal(claims.allowedOrigin, origin); assert.equal(claims.merchantId, merchantId);
      assert.equal(claims.expiresAtUnix - claims.issuedAtUnix, ttlSeconds); assert.equal(claims.cartRef, undefined);
      const sessionId = "chk_embed_" + createHash("sha256").update(JSON.stringify([merchantId, claims.nonce])).digest("hex");
      return { merchantId, auth: registered.body, product, variant: product.variants[0]!, professional, cartRef,
        token: issued.body.embed_session_token as string, claims, sessionId, policy: policy.body,
        date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) };
    }
    type Context = Awaited<ReturnType<typeof context>>;
    const headers = (c: Context, token = alice.token) => ({ origin, "x-aacp-embed-token": c.token, "x-buyer-access-token": token });
    const call = (c: Context, path: string, body?: unknown, method = "POST", custom: Record<string, string> = headers(c)) => request("/embed/service-booking/" + path, body, custom, method);
    const query = (c: Context, extra: Record<string, string> = {}) => new URLSearchParams({ productId: c.product.id, variantId: c.variant.id,
      professionalId: c.professional.id, ...(extra.fromDate ? {} : { date: c.date }), ...extra }).toString();
    async function selected(c: Context, index = 0) {
      const slots = await call(c, "slots?" + query(c), undefined, "GET");
      assert.equal(slots.status, 200, JSON.stringify(slots)); assert.ok(slots.body.selections.length > index);
      const result = await call(c, "select", { selection: slots.body.selections[index] });
      assert.equal(result.status, 201, JSON.stringify(result));
      assert.match(result.body.parent_cart_fingerprint, /^[a-f0-9]{64}$/);
      assert.equal(result.body.service.name, c.product.name); assert.equal(result.body.professional.name, c.professional.publicName);
      assert.equal(result.body.selection.priceInCents, 5000); assert.equal(result.body.selection.timeZone, "America/Sao_Paulo");
      return { selection: result.body.selection, parent_cart_fingerprint: result.body.parent_cart_fingerprint };
    }
    const prepare = (c: Context, choice: Awaited<ReturnType<typeof selected>>) => call(c, "prepare", choice);
    async function snapshot(c: Context) {
      const keys = (await cache.keys("service-slots:{" + createHash("sha256").update(c.merchantId).digest("hex") + "}:*")).sort();
      return { cart: await db.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } } }),
        profile: await db.buyerAccount.findUnique({ where: { globalUserId: alice.row.globalUserId } }),
        checkout: await db.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } } }),
        appointments: await db.serviceAppointment.findMany({ where: { merchantId: c.merchantId } }),
        payments: await db.appointmentPayment.findMany({ where: { merchantId: c.merchantId } }),
        intents: await db.paymentIntent.count({ where: { merchantId: c.merchantId } }),
        audit: await db.appointmentAudit.count({ where: { merchantId: c.merchantId } }),
        startedEvents: await db.outboxMessage.count({ where: { merchantId: c.merchantId, eventType: "checkout.session.started" } }),
        events: await db.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "service-booking" },
          select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }),
        inventory: await db.inventoryMovement.count({ where: { merchantId: c.merchantId } }),
        holds: await Promise.all(keys.map(async key => ({ key, type: await cache.type(key), value: await cache.dump(key) }))) };
    }
    function assertPublic(value: unknown) {
      assert.equal(/generation|ownerHash|privatePaymentContinuation|passwordHash|accessToken|access_token|asaasCustomerId|privateSecret/.test(JSON.stringify(value)), false);
    }
    const base = await context("ordinary-bound");
    await t.test("real60s issuer, empty bound parent and public professional/date/slot selection", async () => {
      const c = await context("ordinary-60", false, "at_attendance", 60), before = await snapshot(c);
      const professionals = await call(c, "professionals?" + new URLSearchParams({ productId: c.product.id, variantId: c.variant.id }), undefined, "GET");
      assert.equal(professionals.status, 200, JSON.stringify(professionals)); assert.equal(professionals.body.professionals.length, 1);
      assert.equal(professionals.body.professionals[0].id, c.professional.id); assert.equal(professionals.body.professionals[0].name, c.professional.publicName);
      const dates = await call(c, "dates?" + query(c, { fromDate: c.date, toDate: c.date }), undefined, "GET");
      assert.equal(dates.status, 200, JSON.stringify(dates)); assert.deepEqual(dates.body.dates, [c.date]);
      const choice = await selected(c); assert.equal(choice.selection.professionalId, c.professional.id);
      assertPublic(professionals.body); assertPublic(dates.body); assert.deepEqual(await snapshot(c), before);
    });
    for (const hold of [false, true]) for (const mode of ["at_attendance", "online"] as const)
      await t.test("canonical prepare and exact replay: " + mode + "/hold=" + hold, async () => {
        const c = await context("policy-" + mode + "-" + hold, hold, mode), choice = await selected(c);
        const made = await prepare(c, choice); assert.equal(made.status, 201, JSON.stringify(made)); assertPublic(made.body);
        assert.equal(made.body.session_id, c.sessionId); assert.equal(made.body.confirmed, false); assert.equal(made.body.payment_mode, mode);
        assert.equal(made.body.requires_hold, hold); assert.equal(made.body.selections.length, 1);
        const persisted = await db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } } });
        assert.equal(persisted.globalUserId, alice.row.globalUserId); assert.equal((persisted.cart as any).cart_ref, c.cartRef);
        assert.equal((persisted.cart as any).items[0].fulfillmentSchedule.professionalId, c.professional.id);
        assert.equal(made.body.cart_fingerprint, paymentCartFingerprint({ cart: persisted.cart as any }));
        const prior = await snapshot(c), lease = made.body.service_slot_hold;
        if (hold) { assert.ok(Date.parse(lease.expiresAt) > Date.now()); assert.ok(Date.parse(lease.expiresAt) <= Date.now() + 4 * 60_000); }
        else { assert.equal(lease, null); assert.deepEqual(prior.holds, []); }
        const retry = await prepare(c, choice); assert.equal(retry.status, 201, JSON.stringify(retry));
        assert.equal(retry.body.replayed, true); assert.equal(retry.body.cart_fingerprint, made.body.cart_fingerprint);
        assert.deepEqual(retry.body.service_slot_hold, lease); assert.deepEqual(await snapshot(c), prior);
        const command = { session_id: c.sessionId, command_id: "confirm-" + c.sessionId, cart_fingerprint: made.body.cart_fingerprint };
        const final = await request("/embed/service-appointments/confirm", command, headers(c));
        if (mode === "online") {
          assert.equal(final.status, 409, JSON.stringify(final)); assert.match(JSON.stringify(final.body), /service_online_payment_required/);
          assert.deepEqual(await snapshot(c), prior);
        } else {
          assert.equal(final.status, 201, JSON.stringify(final)); assert.equal(final.body.appointments.length, 1);
          assert.equal(final.body.appointments[0].professionalId, c.professional.id); assert.equal(final.body.appointments[0].operationalStatus, "scheduled");
          assert.equal(final.body.appointments[0].payments[0].status, "pending"); assert.equal(final.body.appointments[0].payments[0].mode, "at_attendance");
          const replay = await request("/embed/service-appointments/confirm", command, headers(c));
          assert.equal(replay.status, 201, JSON.stringify(replay)); assert.equal(replay.body.replayed, true);
          assert.equal(replay.body.appointments[0].id, final.body.appointments[0].id);
        }
        assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
        assert.equal(await db.inventoryMovement.count({ where: { merchantId: c.merchantId } }), 0);
      });
    await t.test("missing/invalid buyer, foreign origin and injected authority have no effects", async () => {
      const choice = await selected(base), before = await snapshot(base);
      for (const [custom, expected] of [[{ origin, "x-aacp-embed-token": base.token }, 401], [{ ...headers(base), "x-buyer-access-token": "invalid" }, 401],
        [{ ...headers(base), origin: "https://foreign.example.test" }, 403], [{ ...headers(base), origin: "" }, 403]] as const) {
        const result = await call(base, "prepare", choice, "POST", custom);
        assert.equal(result.status, expected, JSON.stringify(result));
      }
      for (const extra of [{ merchantId: "foreign" }, { session_id: "foreign" }, { cart_ref: "foreign" }, { paid: true }]) {
        const result = await call(base, "prepare", { ...choice, ...extra }); assert.equal(result.status, 400, JSON.stringify(result));
      }
      assert.deepEqual(await snapshot(base), before);
    });
    await t.test("foreign product and professional IDs never disclose another tenant", async () => {
      const other = await context("foreign"), choice = await selected(base), before = await snapshot(base);
      for (const selection of [{ ...choice.selection, professionalId: other.professional.id }, { ...choice.selection, productId: other.product.id, variantId: other.variant.id }]) {
        const result = await call(base, "select", { selection }); assert.equal(result.status, 404, JSON.stringify(result));
        assert.equal(JSON.stringify(result.body).includes(other.professional.publicName), false);
      }
      assert.deepEqual(await snapshot(base), before);
    });
    await t.test("changed policy and offer demand new explicit current acceptance", async () => {
      const c = await context("changed-policy"), old = await selected(c), before = await snapshot(c);
      await db.serviceBusinessPolicy.update({ where: { merchantId: c.merchantId }, data: { version: 2, paymentMode: "online" } });
      const stale = await prepare(c, old); assert.equal(stale.status, 409, JSON.stringify(stale));
      assert.deepEqual(await snapshot(c), before);
      const fresh = await selected(c); assert.equal(fresh.selection.policyVersion, 2);
      const made = await prepare(c, fresh); assert.equal(made.status, 201, JSON.stringify(made)); assert.equal(made.body.payment_mode, "online");
      assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
    });
    await t.test("changed price, publication and professional version refuse stale selection before writes", async () => {
      const c = await context("changed-facts"), choice = await selected(c), before = await snapshot(c);
      await db.productPrice.update({ where: { variantId: c.variant.id }, data: { basePriceInCents: 5500 } });
      assert.equal((await prepare(c, choice)).status, 409); assert.deepEqual(await snapshot(c), before);
      await db.productPrice.update({ where: { variantId: c.variant.id }, data: { basePriceInCents: 5000 } });
      await db.serviceProfessional.update({ where: { id: c.professional.id }, data: { version: 2 } });
      assert.equal((await prepare(c, choice)).status, 409); assert.deepEqual(await snapshot(c), before);
      await db.serviceProfessional.update({ where: { id: c.professional.id }, data: { version: 1, isPublished: false } });
      assert.equal((await prepare(c, choice)).status, 404); assert.deepEqual(await snapshot(c), before);
    });
    await t.test("concurrent identical prepare converges; another buyer and changed selection cannot adopt it", async () => {
      const c = await context("concurrent", true), choice = await selected(c);
      const results = await Promise.all([prepare(c, choice), prepare(c, choice)]);
      assert.deepEqual(results.map(x => x.status), [201, 201], JSON.stringify(results));
      assert.equal(results[0].body.session_id, results[1].body.session_id);
      assert.equal(results[0].body.cart_fingerprint, results[1].body.cart_fingerprint);
      assert.deepEqual(results[0].body.service_slot_hold, results[1].body.service_slot_hold);
      const before = await snapshot(c); assert.equal(before.cart!.items instanceof Array, true); assert.equal((before.cart!.items as any[]).length, 1);
      assert.equal(before.startedEvents, 1);
      const wrongBuyer = await call(c, "prepare", choice, "POST", headers(c, bob.token));
      assert.equal(wrongBuyer.status, 401, JSON.stringify(wrongBuyer));
      const slots = await call(c, "slots?" + query(c), undefined, "GET"); assert.equal(slots.status, 200);
      const changed = await prepare(c, { ...choice, selection: slots.body.selections[1] });
      assert.equal(changed.status, 409, JSON.stringify(changed)); assert.deepEqual(await snapshot(c), before);
    });
    await t.test("parent CAS never erases another line or a pre-existing benefit", async () => {
      const c = await context("parent-cas"), choice = await selected(c);
      const physical = { variantId: "not-a-service", productId: "other-product", name: "Preserved product", sku: "OTHER", quantity: 2, unitPriceCents: 1700 };
      await db.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } },
        create: { merchantId: c.merchantId, sessionId: c.cartRef, items: [physical], total: 3400, expiresAt: new Date(Date.now() + 60_000) },
        update: { items: [physical], total: 3400 } });
      const before = await snapshot(c); assert.equal((await prepare(c, choice)).status, 409); assert.deepEqual(await snapshot(c), before);
      await db.storefrontCart.update({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } }, data: { items: [], total: 0, couponCode: "PRESERVE", discount: 0, freeShipping: true } });
      const benefited = await snapshot(c); assert.equal((await prepare(c, choice)).status, 409); assert.deepEqual(await snapshot(c), benefited);
    });
    await t.test("another existing service unit survives append and confirms as part of the full cart", async () => {
      const c = await context("two-units"), first = await selected(c), oldLine = { variantId: c.variant.id, productId: c.product.id,
        name: c.product.name, sku: c.variant.sku, quantity: 1, unitPriceCents: 5000, selectedServiceSlot: {
          slotId: first.selection.slotId, professionalId: first.selection.professionalId, professionalVersion: first.selection.professionalVersion,
          policyVersion: first.selection.policyVersion, date: first.selection.date, startsAt: first.selection.startsAt,
          endsAt: first.selection.endsAt, timeZone: first.selection.timeZone, durationMinutes: first.selection.durationMinutes } };
      await db.storefrontCart.create({ data: { merchantId: c.merchantId, sessionId: c.cartRef, items: [oldLine], total: 5000,
        expiresAt: new Date(Date.now() + 60_000) } });
      const next = await selected(c, 1), made = await prepare(c, next); assert.equal(made.status, 201, JSON.stringify(made));
      const stored = await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } } });
      assert.deepEqual((stored.items as any[])[0], oldLine); assert.equal((stored.items as any[]).length, 2); assert.equal(stored.total, 10000);
      assert.equal(made.body.selections.length, 2); assert.deepEqual(made.body.selections.map((x: any) => x.startsAt).sort(), [first.selection.startsAt, next.selection.startsAt].sort());
      const finalized = await request("/embed/service-appointments/confirm", { session_id: c.sessionId, command_id: "two-units",
        cart_fingerprint: made.body.cart_fingerprint }, headers(c));
      assert.equal(finalized.status, 201, JSON.stringify(finalized)); assert.equal(finalized.body.appointments.length, 2);
      assert.equal(await db.appointmentPayment.count({ where: { merchantId: c.merchantId, status: "pending" } }), 2);
      assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
    });
    await t.test("concurrent different choices against the same parent never overwrite the winner", async () => {
      const c = await context("different-choices"), a = await selected(c), b = await selected(c, 1);
      assert.equal(a.parent_cart_fingerprint, b.parent_cart_fingerprint);
      const results = await Promise.all([prepare(c, a), prepare(c, b)]);
      assert.deepEqual(results.map(x => x.status).sort(), [201, 409], JSON.stringify(results));
      const winner = results.find(x => x.status === 201)!, current = await snapshot(c);
      assert.equal((current.cart!.items as any[]).length, 1); assert.equal((current.checkout!.cart as any).items.length, 1);
      assert.equal(paymentCartFingerprint({ cart: current.checkout!.cart as any }), winner.body.cart_fingerprint);
      assert.equal(current.appointments.length, 0); assert.equal(current.intents, 0);
    });
    await t.test("real foreign Redis lease hides capacity and a backend read failure stays unavailable", async () => {
      const c = await context("live-redis", true), choice = await selected(c), store = new RedisServiceSlots(cache);
      await store.acquire(c.merchantId, "another-checkout", [{ resourceId: "professional:" + c.professional.id,
        slotId: choice.selection.slotId, startsAt: choice.selection.startsAt, endsAt: choice.selection.endsAt }], 240_000);
      const before = await snapshot(c), slots = await call(c, "slots?" + query(c), undefined, "GET");
      assert.equal(slots.status, 200, JSON.stringify(slots)); assert.equal(slots.body.selections.some((x: any) => x.slotId === choice.selection.slotId), false);
      const unavailable = await prepare(c, choice); assert.equal(unavailable.status, 409, JSON.stringify(unavailable)); assert.deepEqual(await snapshot(c), before);
      await store.release(c.merchantId, "another-checkout");
      const resourceKey = store.resourceKey(c.merchantId, "professional:" + c.professional.id);
      await cache.set(resourceKey, "synthetic-wrong-type");
      try {
        const brokenBefore = await snapshot(c), failed = await call(c, "slots?" + query(c), undefined, "GET");
        assert.equal(failed.status, 503, JSON.stringify(failed)); assert.match(JSON.stringify(failed.body), /service_schedule_temporarily_unavailable/);
        assert.deepEqual(await snapshot(c), brokenBefore);
      } finally { await cache.del(resourceKey); }
    });
    await t.test("OFF promises no capacity before final confirmation; the actual capacity race has one winner", async () => {
      const c = await context("capacity-race"), first = await selected(c), made = await prepare(c, first); assert.equal(made.status, 201);
      const conversation = await request("/storefront/conversations", { merchant_id: c.merchantId, buyer_access_token: bob.token }, { origin });
      assert.equal(conversation.status, 201);
      const issued = await runtime.buyerBooking.issue({ merchantId: c.merchantId, body: { cart_ref: conversation.body.conversation_id,
        conversation_token: conversation.body.conversation_token, allowed_origin: origin, scopes: ["checkout:start", "appointments:confirm"] } });
      assert.equal(issued.status, 201);
      const claims = JSON.parse(Buffer.from(issued.body.embed_session_token.split(".")[0], "base64url").toString("utf8"));
      const c2 = { ...c, cartRef: conversation.body.conversation_id, token: issued.body.embed_session_token,
        sessionId: "chk_embed_" + createHash("sha256").update(JSON.stringify([c.merchantId, claims.nonce])).digest("hex") };
      const slots = await call(c2, "slots?" + query(c2), undefined, "GET", headers(c2, bob.token)); assert.equal(slots.status, 200);
      const quoted = await call(c2, "select", { selection: slots.body.selections[0] }, "POST", headers(c2, bob.token)); assert.equal(quoted.status, 201);
      const made2 = await call(c2, "prepare", { selection: quoted.body.selection, parent_cart_fingerprint: quoted.body.parent_cart_fingerprint }, "POST", headers(c2, bob.token));
      assert.equal(made2.status, 201, JSON.stringify(made2)); assert.equal(made2.body.service_slot_hold, null);
      assert.equal(await db.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 0);
      const final = await Promise.all([request("/embed/service-appointments/confirm", { session_id: c.sessionId, command_id: "race-a", cart_fingerprint: made.body.cart_fingerprint }, headers(c)),
        request("/embed/service-appointments/confirm", { session_id: c2.sessionId, command_id: "race-b", cart_fingerprint: made2.body.cart_fingerprint }, headers(c2, bob.token))]);
      assert.deepEqual(final.map(x => x.status).sort(), [201, 409], JSON.stringify(final));
      assert.equal(await db.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 1);
      assert.equal(await db.appointmentPayment.count({ where: { merchantId: c.merchantId, status: "pending" } }), 1);
      assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
    });
    await t.test("real transactional failure rolls back appointments, pending money, audit and outbox", async () => {
      const c = await context("atomic-failure"), choice = await selected(c), made = await prepare(c, choice); assert.equal(made.status, 201);
      const before = await snapshot(c); assert.match(c.merchantId, /^[A-Za-z0-9_-]+$/);
      await db.$executeRawUnsafe("CREATE FUNCTION t40_reject_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id='" + c.merchantId + "' THEN RAISE EXCEPTION 'synthetic_t40_atomic_failure'; END IF; RETURN NEW; END $$");
      await db.$executeRawUnsafe("CREATE TRIGGER t40_reject_payment BEFORE INSERT ON appointment_payments FOR EACH ROW EXECUTE FUNCTION t40_reject_payment()");
      try {
        const failed = await request("/embed/service-appointments/confirm", { session_id: c.sessionId, command_id: "atomic-failure", cart_fingerprint: made.body.cart_fingerprint }, headers(c));
        assert.equal(failed.status, 500, JSON.stringify(failed)); assert.deepEqual(await snapshot(c), before);
      } finally {
        await db.$executeRawUnsafe("DROP TRIGGER t40_reject_payment ON appointment_payments"); await db.$executeRawUnsafe("DROP FUNCTION t40_reject_payment()");
      }
    });
    await t.test("the canonical creation writer checks fresh DB time after its own session-anchor wait", async () => {
      const c = await context("creation-expiry", true, "at_attendance", 60), choice = await selected(c);
      const sourceLine = { variantId: c.variant.id, productId: c.product.id, name: c.product.name, sku: c.variant.sku,
        quantity: 1, unitPriceCents: 5000, selectedServiceSlot: { slotId: choice.selection.slotId, professionalId: c.professional.id,
          professionalVersion: choice.selection.professionalVersion, policyVersion: choice.selection.policyVersion, date: c.date,
          startsAt: choice.selection.startsAt, endsAt: choice.selection.endsAt, timeZone: choice.selection.timeZone, durationMinutes: 20 } };
      const source = await db.storefrontCart.create({ data: { merchantId: c.merchantId, sessionId: c.cartRef, items: [sourceLine], total: 5000,
        expiresAt: new Date(Date.now() + 60_000) } });
      const { serviceBookingParentFingerprint } = await import("../dist/shared/bookings/service-checkout-provenance.js");
      const shortened = await runtime.buyerBooking.shorten({ token: c.token, seconds: 3, merchantId: c.merchantId, cartRef: c.cartRef, origin });
      assert.equal(shortened.fixtureShortTTL, true);
      const claims = JSON.parse(Buffer.from(shortened.token.split(".")[0], "base64url").toString("utf8"));
      const admitted = await call(c, "select", { selection: choice.selection }, "POST", { ...headers(c), "x-aacp-embed-token": shortened.token });
      assert.equal(admitted.status, 201, JSON.stringify(admitted));
      const { PrismaCheckoutRepository } = await import("../dist/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js");
      const { CheckoutSessionEntity } = await import("../dist/modules/checkout/domain/entities/checkout-session.entity.js");
      const slot = choice.selection;
      const cart = { currency: "BRL", source: "storefront", cart_ref: c.cartRef, total: 50, items: [{ sku: c.variant.sku,
        product_id: c.product.id, variantId: c.variant.id, name: c.product.name, quantity: 1, price: 50,
        productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: {
          slotId: slot.slotId, professionalId: slot.professionalId, professionalVersion: slot.professionalVersion,
          policyVersion: slot.policyVersion, date: slot.date, startsAt: slot.startsAt, endsAt: slot.endsAt,
          timeZone: slot.timeZone, durationMinutes: slot.durationMinutes } }] };
      const session = CheckoutSessionEntity.create({ merchantId: c.merchantId, sessionId: c.sessionId, globalUserId: alice.row.globalUserId,
        conversationId: "owned_creation_" + c.sessionId, cart: cart as any,
        customer: { email: alice.row.email, email_verified: true, fullName: alice.row.displayName } }).snapshot();
      const capability = { merchantId: c.merchantId, sessionId: c.sessionId, globalUserId: alice.row.globalUserId,
        allowedOrigin: origin, expiresAtUnix: claims.expiresAtUnix, cartFingerprint: paymentCartFingerprint({ cart: cart as any }),
        storefrontCartRef: c.cartRef, parentCartFingerprint: serviceBookingParentFingerprint(source as any) };
      const before = await snapshot(c); let acquired!: () => void, release!: () => void, blockerPid = 0;
      const ready = new Promise<void>(resolve => { acquired = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.$transaction(async tx => {
        await lockCheckoutSessionAnchor(tx, c.merchantId, c.sessionId);
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blockerPid = pid!.pid; acquired(); await released;
      }, { timeout: 15_000 });
      await ready;
      const pending = new PrismaCheckoutRepository(db).createSessionIfAbsent(session, { serverChannel: "storefront",
        trustedBuyer: { globalUserId: alice.row.globalUserId, customer: { email: alice.row.email, email_verified: true } }, bookingCapability: capability });
      const rejected = assert.rejects(pending, /embed_session_token_expired/);
      try {
        const deadline = Date.now() + 7000; let observed = false, expired = false;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<Array<{ waiting: number; now: Date }>>`SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid}=ANY(pg_blocking_pids(pid))) AS waiting,clock_timestamp() AS now`;
          observed ||= row!.waiting > 0; expired = row!.now.getTime() >= claims.expiresAtUnix * 1000;
          if (observed && expired) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(observed, true, "real_creation_anchor_wait_required"); assert.equal(expired, true);
      } finally { release(); await blocker; }
      await rejected; assert.deepEqual(await snapshot(c), before);
    });
    await t.test("an existing winner cannot bypass current whole-parent source and benefit checks", async () => {
      const c = await context("winner-source"), choice = await selected(c), made = await prepare(c, choice); assert.equal(made.status, 201);
      const row = await db.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } } });
      const source = await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } } });
      const { PrismaCheckoutRepository } = await import("../dist/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js");
      const { toCheckoutSession } = await import("../dist/modules/checkout/infrastructure/prisma/checkout-session.mapper.js");
      const { serviceBookingParentFingerprint } = await import("../dist/shared/bookings/service-checkout-provenance.js");
      const capability = { merchantId: c.merchantId, sessionId: c.sessionId, globalUserId: alice.row.globalUserId,
        allowedOrigin: origin, expiresAtUnix: c.claims.expiresAtUnix, cartFingerprint: made.body.cart_fingerprint,
        storefrontCartRef: c.cartRef, parentCartFingerprint: serviceBookingParentFingerprint(source as any) };
      await db.storefrontCart.update({ where: { id: source.id }, data: { freeShipping: true } });
      const before = await snapshot(c);
      await assert.rejects(() => new PrismaCheckoutRepository(db).createSessionIfAbsent(toCheckoutSession(row), {
        serverChannel: "storefront", trustedBuyer: { globalUserId: alice.row.globalUserId,
          customer: { email: alice.row.email, email_verified: true } }, bookingCapability: capability }), /service_booking_parent_changed/);
      assert.deepEqual(await snapshot(c), before);
    });
    await t.test("expired-after-lock capability rolls back source, checkout, hold and financial effects", async () => {
      const c = await context("expiry-lock", true, "at_attendance", 60), choice = await selected(c);
      const shortened = await runtime.buyerBooking.shorten({ token: c.token, seconds: 3, merchantId: c.merchantId, cartRef: c.cartRef, origin });
      assert.equal(shortened.fixtureShortTTL, true);
      const originalClaims = c.claims, claims = JSON.parse(Buffer.from(shortened.token.split(".")[0], "base64url").toString("utf8"));
      const { expiresAtUnix: beforeExpiry, ...originalRest } = originalClaims, { expiresAtUnix: afterExpiry, ...shortRest } = claims;
      assert.deepEqual(shortRest, originalRest); assert.ok(afterExpiry < beforeExpiry); assert.ok(afterExpiry > Math.floor(Date.now() / 1000));
      const before = await snapshot(c); let acquired!: () => void, release!: () => void, blockerPid = 0;
      const ready = new Promise<void>(resolve => { acquired = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`;
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blockerPid = pid!.pid; acquired(); await released;
      }, { timeout: 15_000 });
      await ready;
      const pending = call(c, "prepare", choice, "POST", { ...headers(c), "x-aacp-embed-token": shortened.token });
      try {
        const deadline = Date.now() + 7000; let observed = false, expired = false;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<Array<{ waiting: number; now: Date }>>`SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid}=ANY(pg_blocking_pids(pid))) AS waiting,clock_timestamp() AS now`;
          observed ||= row!.waiting > 0;
          expired = row!.now.getTime() >= afterExpiry * 1000;
          if (observed && expired) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(observed, true, "real_sql_lock_wait_required");
        assert.equal(expired, true);
      } finally { release(); await blocker; }
      const denied = await pending; assert.equal(denied.status, 401, JSON.stringify(denied)); assert.match(JSON.stringify(denied.body), /embed_session_token_expired/);
      assert.deepEqual(await snapshot(c), before);
    });
    await t.test("missing lease stays read-only until explicit same-capability checkout review and continuation", async () => {
      const c = await context("explicit-continuation", true), choice = await selected(c), store = new RedisServiceSlots(cache);
      const key = store.checkoutKey(c.merchantId, c.sessionId);
      // Canonical resource reads still work. The acquire script fails decoding
      // its old checkout record before it can mutate a lease; SQL is real.
      await cache.set(key, "synthetic-invalid-before-acquisition");
      const failed = await prepare(c, choice); assert.equal(failed.status, 503, JSON.stringify(failed));
      const persisted = await snapshot(c); assert.equal(persisted.checkout, null); assert.equal((persisted.cart!.items as any[]).length, 1);
      assert.equal(persisted.appointments.length, 0); assert.equal(persisted.intents, 0); assert.equal(persisted.payments.length, 0);
      assert.equal(persisted.startedEvents, 0); assert.equal(await cache.type(store.resourceKey(c.merchantId, "professional:" + c.professional.id)), "none");
      await cache.del(key); // Repair only the explicitly injected owned fixture.
      const recovered = await prepare(c, choice); assert.equal(recovered.status, 201, JSON.stringify(recovered));
      assert.equal(recovered.body.session_id, c.sessionId); assert.ok(recovered.body.service_slot_hold);
      const { captureAppointmentLease } = await import("../src/shared/bookings/appointment-lease-proof.js");
      const recoveredProof = await store.assertActive(c.merchantId, c.sessionId, recovered.body.service_slot_hold.slots);
      for (const slot of recovered.body.service_slot_hold.slots)
        await store.releaseCaptured(c.merchantId, captureAppointmentLease(c.merchantId, c.sessionId, recoveredProof, slot));
      const before = await snapshot(c), retry = await prepare(c, choice);
      assert.equal(retry.status, 409, JSON.stringify(retry)); assert.equal(retry.body.code, "service_hold_required");
      assert.equal(retry.body.next_action, "review_checkout"); assert.deepEqual(await snapshot(c), before); assertPublic(retry.body);
      const continued = await request("/embed/start", { cart: before.checkout!.cart, buyer_access_token: alice.token }, headers(c));
      assert.equal(continued.status, 201, JSON.stringify(continued)); assert.equal(continued.body.session_id, c.sessionId);
      assert.equal(continued.body.service_checkout.cart_fingerprint, paymentCartFingerprint({ cart: before.checkout!.cart as any }));
      assert.equal(continued.body.service_checkout.requires_hold, true); assert.ok(continued.body.service_slot_hold);
      const after = await snapshot(c); assert.equal((after.cart!.items as any[]).length, 1); assert.equal(after.startedEvents, 1);
      assert.equal(after.appointments.length, 0); assert.equal(after.intents, 0); assert.equal(after.inventory, 0);
      assert.ok(Date.parse(continued.body.service_slot_hold.expiresAt) > Date.now());
    });
    await t.test("explicit continuation rechecks expiry after a real lock; committed resume remains historical", async () => {
      const c = await context("continuation-expiry", true, "at_attendance", 60), choice = await selected(c), made = await prepare(c, choice);
      assert.equal(made.status, 201, JSON.stringify(made));
      const short = await runtime.buyerBooking.shorten({ token: c.token, seconds: 3, merchantId: c.merchantId, cartRef: c.cartRef, origin });
      assert.equal(short.fixtureShortTTL, true); const before = await snapshot(c);
      let release!: () => void, locked!: (pid: number) => void;
      const barrier = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<number>(resolve => { locked = resolve; });
      const blocker = db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`; locked(pid); await barrier;
      }, { timeout: 15_000 });
      const pid = await acquired;
      const pending = request("/embed/start", { cart: before.checkout!.cart, buyer_access_token: alice.token }, { ...headers(c), "x-aacp-embed-token": short.token });
      let observed = false, expired = false;
      try {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<Array<{ waiting: number; now: Date }>>`SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND ${pid}=ANY(pg_blocking_pids(pid))) AS waiting,clock_timestamp() AS now`;
          observed ||= row!.waiting > 0; expired = row!.now.getTime() >= short.expiresAtUnix * 1000;
          if (observed && expired) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(observed, true, "real_continuation_lock_wait_required"); assert.equal(expired, true);
      } finally { release(); await blocker; }
      const denied = await pending; assert.equal(denied.status, 401, JSON.stringify(denied));
      assert.match(JSON.stringify(denied.body), /embed_session_token_expired/); assert.deepEqual(await snapshot(c), before);
      const confirmed = await request("/embed/service-appointments/confirm", { session_id: c.sessionId, command_id: "commit-" + c.sessionId,
        cart_fingerprint: made.body.cart_fingerprint }, headers(c));
      assert.equal(confirmed.status, 201, JSON.stringify(confirmed)); const committed = await snapshot(c);
      const resumed = await request("/embed/start", { cart: committed.checkout!.cart, buyer_access_token: alice.token }, headers(c));
      assert.equal(resumed.status, 201, JSON.stringify(resumed)); assert.equal(resumed.body.session_id, c.sessionId);
      assert.equal((await snapshot(c)).appointments.length, 1); assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
    });
    await t.test("initial creator lease exists before SQL publication and the HTTP read-only loser keeps its original proof", async () => {
      const c = await context("initial-publication", true), choice = await selected(c);
      assert.match(c.merchantId, /^[A-Za-z0-9_-]+$/);
      const barrier = "t40-initial-publication-" + c.merchantId;
      await db.$executeRawUnsafe("CREATE FUNCTION t40_initial_publication_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id='" + c.merchantId + "' THEN PERFORM pg_advisory_xact_lock(hashtextextended('" + barrier + "',0)); END IF; RETURN NEW; END $$");
      await db.$executeRawUnsafe("CREATE TRIGGER t40_initial_publication_barrier AFTER INSERT ON checkout_sessions FOR EACH ROW EXECUTE FUNCTION t40_initial_publication_barrier()");
      let acquired!: () => void, release!: () => void, blockerPid = 0;
      const ready = new Promise<void>(resolve => { acquired = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
      const blocker = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS held FROM pg_advisory_xact_lock(hashtextextended(${barrier},0))`;
        const [pid] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; blockerPid = pid!.pid; acquired(); await released;
      }, { timeout: 15_000 });
      const settledBlocker = blocker.then(() => undefined, error => error);
      let first: ReturnType<typeof prepare> | undefined, second: ReturnType<typeof prepare> | undefined;
      try {
        await Promise.race([ready, blocker]);
        first = prepare(c, choice); void first.catch(() => {});
        const deadline = Date.now() + 7000; let observed = false;
        while (Date.now() < deadline) {
          const [row] = await db.$queryRaw<Array<{ waiting: number }>>`SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND ${blockerPid}=ANY(pg_blocking_pids(pid))`;
          if (row!.waiting > 0) { observed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(observed, true, "actual checkout insert must wait before its SQL transaction commits");
        assert.equal(await db.checkoutSession.count({ where: { merchantId: c.merchantId, sessionId: c.sessionId } }), 0, "uncommitted checkout is not publicly visible");
        const store = new RedisServiceSlots(cache), hold = await store.get(c.merchantId, c.sessionId);
        assert.ok(hold, "initial lease must already exist while the SQL checkout remains uncommitted");
        const original = await store.assertActive(c.merchantId, c.sessionId, hold.slots);
        second = prepare(c, choice); void second.catch(() => {}); release(); await blocker;
        const results = await Promise.all([first, second]); assert.deepEqual(results.map(result => result.status), [201, 201], JSON.stringify(results));
        assert.equal(results[0]!.body.session_id, c.sessionId); assert.equal(results[1]!.body.session_id, c.sessionId);
        assert.equal(results[0]!.body.cart_fingerprint, results[1]!.body.cart_fingerprint);
        assert.deepEqual(results[0]!.body.service_slot_hold, hold); assert.deepEqual(results[1]!.body.service_slot_hold, hold);
        assert.deepEqual(await store.assertActive(c.merchantId, c.sessionId, hold.slots), original, "creator continuation and read-only loser cannot change original generation or expiry");
        const current = await snapshot(c); assert.equal(current.startedEvents, 1); assert.ok(current.checkout);
        assert.equal(current.appointments.length, 0); assert.equal(current.payments.length, 0); assert.equal(current.intents, 0); assert.equal(current.inventory, 0);
      } finally {
        release(); await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])]);
        const failedBlocker = await settledBlocker;
        await db.$executeRawUnsafe("DROP TRIGGER t40_initial_publication_barrier ON checkout_sessions");
        await db.$executeRawUnsafe("DROP FUNCTION t40_initial_publication_barrier()");
        if (failedBlocker) throw failedBlocker;
      }
    });
    await t.test("direct canonical SQL timeout cannot compensate a generation adopted by a later committed publisher", async () => {
      // Direct canonical writer proof with real SQL/Redis/Lua, not another HTTP
      // admission. The genuine issuer and catalog select establish its fixture.
      const c = await context("publication-adoption", true), choice = await selected(c), slot = choice.selection;
      const { PrismaCheckoutRepository } = await import("../dist/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js");
      const { CheckoutSessionEntity } = await import("../dist/modules/checkout/domain/entities/checkout-session.entity.js");
      const { RedisServiceSlots: EmittedRedisSlots, newlyCreatedSlotLeaseProof, originalSlotLeaseProof } = await import("../dist/shared/bookings/redis-service-slots.js");
      const { professionalScheduleSnapshot, professionalStorefrontSlot } = await import("../dist/shared/bookings/service-checkout-cart.js");
      const { serviceBookingParentFingerprint } = await import("../dist/shared/bookings/service-checkout-provenance.js");
      const source = await db.storefrontCart.create({ data: { merchantId: c.merchantId, sessionId: c.cartRef, items: [{ variantId: c.variant.id,
        productId: c.product.id, name: c.product.name, sku: c.variant.sku, quantity: 1, unitPriceCents: 5000, selectedServiceSlot: professionalStorefrontSlot(slot) }],
        total: 5000, expiresAt: new Date(Date.now() + 900_000) } });
      const cart = { currency: "BRL", source: "storefront", cart_ref: c.cartRef, total: 50, items: [{ sku: c.variant.sku,
        product_id: c.product.id, variantId: c.variant.id, name: c.product.name, quantity: 1, price: 50, productType: "service",
        fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: professionalScheduleSnapshot(slot) }] };
      const session = CheckoutSessionEntity.create({ merchantId: c.merchantId, sessionId: c.sessionId, globalUserId: alice.row.globalUserId,
        conversationId: "publication_" + c.sessionId, cart: cart as any, customer: { email: alice.row.email, email_verified: true } }).snapshot();
      const identity = { serverChannel: "storefront" as const, trustedBuyer: { globalUserId: alice.row.globalUserId,
        customer: { email: alice.row.email, email_verified: true as const } }, bookingCapability: { merchantId: c.merchantId,
        sessionId: c.sessionId, globalUserId: alice.row.globalUserId, allowedOrigin: origin, expiresAtUnix: c.claims.expiresAtUnix,
        cartFingerprint: paymentCartFingerprint(session), storefrontCartRef: c.cartRef, parentCartFingerprint: serviceBookingParentFingerprint(source as any) } };
      const store = new EmittedRedisSlots(cache); let acknowledge!: () => void, releaseAck!: () => void, finishCallback!: () => void;
      const ackReady = new Promise<void>(resolve => { acknowledge = resolve; }), ackAllowed = new Promise<void>(resolve => { releaseAck = resolve; });
      const callbackFinished = new Promise<void>(resolve => { finishCallback = resolve; });
      const bounded = async <T>(work: Promise<T>, code: string): Promise<T> => { let timer: ReturnType<typeof setTimeout> | undefined;
        try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(code)), 15_000); })]); }
        finally { clearTimeout(timer); } };
      let receipt: ReturnType<typeof newlyCreatedSlotLeaseProof>, claimA: string | undefined, attemptedClaim: string | undefined;
      let cleanupAttempts = 0, cleanupResult: { released: boolean } | undefined, staleLuaCalls = 0, staleLuaReply: unknown;
      const originalEval = cache.eval;
      Reflect.set(cache, "eval", async function (this: typeof cache, script: string, keyCount: number, ...args: unknown[]) {
        const result = await Reflect.apply(originalEval, this, [script, keyCount, ...args]);
        if (typeof script === "string" && script.includes("local encoded = ARGV[5]") && args[args.length - 1] === claimA) { staleLuaCalls++; staleLuaReply = result; }
        return result;
      });
      const delayedAck = {
        acquire: async (...args: Parameters<typeof store.acquire>) => { const hold = await store.acquire(...args);
          receipt = newlyCreatedSlotLeaseProof(hold); assert.ok(receipt, "the emitted repository module must receive its actual NEW private receipt");
          claimA = args[4]?.publicationClaim; assert.match(claimA!, /^[a-f0-9-]{36}$/); acknowledge(); await ackAllowed; return hold; },
        releaseCaptured: async (...args: Parameters<typeof store.releaseCaptured>) => { cleanupAttempts++; attemptedClaim = args[2]?.publicationClaim;
          cleanupResult = await store.releaseCaptured(...args); return cleanupResult; },
      };
      // Observe the actual callback's completion only. The real Prisma client,
      // callback transaction, options, default timeout, SQL and result stay intact.
      const observed = new Proxy(db, { get(target, key, receiver) {
        if (key === "$transaction") return (work: (tx: any) => Promise<unknown>, ...options: unknown[]) => Reflect.apply(target.$transaction, target,
          [async (tx: any) => { try { return await work(tx); } finally { finishCallback(); } }, ...options]);
        return Reflect.get(target, key, receiver);
      } });
      const pendingA = new PrismaCheckoutRepository(observed, false, undefined, () => delayedAck).createSessionIfAbsent(session, identity);
      const settledA = pendingA.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      try {
        await bounded(Promise.race([ackReady, settledA.then(result => { throw result.ok ? Error("creator_finished_before_delayed_ACK") : result.error; })]), "publication_initial_ACK_not_observed");
        const first = await store.assertActive(c.merchantId, c.sessionId, receipt!.slots); assert.deepEqual(first, receipt);
        // This FOR UPDATE can finish only after A's actual default interactive
        // transaction timeout/rollback releases its merchant lock. B starts fresh
        // afterwards, so B does not spend its own timeout waiting for A.
        await db.$transaction(async tx => { const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id=${c.merchantId} FOR UPDATE`; assert.equal(rows.length, 1); }, { timeout: 15_000 });
        assert.equal(await db.checkoutSession.count({ where: { merchantId: c.merchantId, sessionId: c.sessionId } }), 0);
        const winner = await new PrismaCheckoutRepository(db, false, undefined, () => store).createSessionIfAbsent(session, identity);
        assert.equal(winner.created, true); const committed = (await snapshot(c)).checkout!; assert.ok(committed);
        const adopted = JSON.parse((await cache.get(store.checkoutKey(c.merchantId, c.sessionId)))!);
        assert.notEqual(adopted.publicationClaim, claimA); assert.match(adopted.publicationClaim, /^[a-f0-9-]{36}$/);
        assert.deepEqual(await store.assertActive(c.merchantId, c.sessionId, first.slots), first);
        releaseAck(); const failed = await bounded(settledA, "publication_late_creator_not_settled");
        await bounded(callbackFinished, "publication_actual_callback_not_finished"); assert.equal(failed.ok, false);
        if (failed.ok) throw Error("expired_creator_must_not_publish");
        const expired = (error: any): boolean => error?.code === "P2028" || Array.isArray(error?.errors) && error.errors.some(expired);
        assert.equal(expired(failed.error), true, "actual Prisma transaction-expiration error required");
        assert.equal(cleanupAttempts, 1); assert.equal(attemptedClaim, claimA); assert.deepEqual(cleanupResult, { released: false });
        assert.equal(staleLuaCalls, 1, "the real Redis CAS must run, not only a JS pre-read refusal"); assert.equal(staleLuaReply, "publication_adopted");
        assert.deepEqual((await snapshot(c)).checkout, committed); assert.equal(JSON.parse((await cache.get(store.checkoutKey(c.merchantId, c.sessionId)))!).publicationClaim, adopted.publicationClaim);
        assert.deepEqual(await store.assertActive(c.merchantId, c.sessionId, first.slots), first);
        const after = await snapshot(c); assert.equal(after.appointments.length, 0); assert.equal(after.payments.length, 0); assert.equal(after.intents, 0); assert.equal(after.inventory, 0);
        assert.deepEqual(originalSlotLeaseProof(await store.acquire(c.merchantId, c.sessionId, first.slots)), first);
      } finally {
        releaseAck(); try { await bounded(settledA, "publication_creator_cleanup_not_settled"); await bounded(callbackFinished, "publication_callback_cleanup_not_finished"); }
        finally { Reflect.set(cache, "eval", originalEval); }
      }
    });
    await t.test("direct canonical SQL/Redis read-only winner retains the original proof and never reacquires missing or expired lease", async () => {
      // This is direct canonical lease proof over an HTTP-created checkout,
      // not a second HTTP binding or an invented concurrency barrier.
      const c = await context("readonly-winner", true), choice = await selected(c), made = await prepare(c, choice);
      assert.equal(made.status, 201, JSON.stringify(made));
      const { ServiceSlotHoldsService } = await import("../dist/shared/bookings/service-slot-holds.service.js");
      const { toCheckoutSession } = await import("../dist/modules/checkout/infrastructure/prisma/checkout-session.mapper.js");
      const { serviceBookingParentFingerprint } = await import("../dist/shared/bookings/service-checkout-provenance.js");
      const row = (await snapshot(c)).checkout!, session = toCheckoutSession(row), store = new RedisServiceSlots(cache);
      const source = await db.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.cartRef } } });
      const cap = { merchantId: c.merchantId, sessionId: c.sessionId, globalUserId: alice.row.globalUserId,
        allowedOrigin: origin, expiresAtUnix: c.claims.expiresAtUnix, cartFingerprint: paymentCartFingerprint(session),
        storefrontCartRef: c.cartRef, parentCartFingerprint: serviceBookingParentFingerprint(source as any) };
      const holds = new ServiceSlotHoldsService(db, store), active = await snapshot(c);
      const read = await holds.prepareProfessionalCheckout(session, cap, { readonlyWinner: true });
      assert.deepEqual(read!.hold, made.body.service_slot_hold); assert.deepEqual(await snapshot(c), active);
      await cache.del(store.checkoutKey(c.merchantId, c.sessionId), store.resourceKey(c.merchantId, "professional:" + c.professional.id));
      const missing = await snapshot(c);
      await assert.rejects(() => holds.prepareProfessionalCheckout(session, cap, { readonlyWinner: true }), /service_hold_required/);
      assert.deepEqual(await snapshot(c), missing);
      const reviewed = await holds.prepareProfessionalCheckout(session, { ...cap, leaseIntent: "review_checkout" }, { readonlyWinner: true });
      assert.ok(reviewed!.hold); assert.equal(await db.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 0);
      assert.equal(await db.paymentIntent.count({ where: { merchantId: c.merchantId } }), 0);
      const key = store.checkoutKey(c.merchantId, c.sessionId), stale = JSON.parse((await cache.get(key))!);
      const [{ now }] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      stale.expiresAt = now.getTime() - 1; await cache.set(key, JSON.stringify(stale));
      const expired = await snapshot(c);
      await assert.rejects(() => holds.prepareProfessionalCheckout(session, cap, { readonlyWinner: true }), /service_hold_required/);
      assert.deepEqual(await snapshot(c), expired);
    });
    assert.equal(runtime.evidence().providerCalls, 0); assert.equal(runtime.evidence().authOverrides, false);
  } finally {
    const errors: unknown[] = [];
    try { if (redis) { await redis.quit(); redis.disconnect(); } } catch (error) { errors.push(error); }
    try { await prisma?.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "service_buyer_booking_owned_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  }
});
