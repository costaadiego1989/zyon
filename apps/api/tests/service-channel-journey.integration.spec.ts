import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readProfessionalCheckoutSelections, type ProfessionalCheckoutSelection } from "../src/shared/bookings/service-checkout-selection.js";
import { createNativeServiceJourneyFixture, type NativeJourneyCase } from "./service-channel-journey.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { currentWhatsAppExecution } from "../src/shared/whatsapp/whatsapp-automation-context.js";
import { readStoredServiceOrigin } from "../src/shared/bookings/service-checkout-provenance.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { captureStorefrontCouponForPayment } from "../src/modules/coupons/infrastructure/repositories/prisma-storefront-coupon-admission.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { ResumePaymentCreationService } from "../src/modules/payment/application/resume-payment-creation.service.js";
import { ServiceSlotHoldsService } from "../src/shared/bookings/service-slot-holds.service.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { PrismaOutboxRepository } from "../src/shared/messaging/infrastructure/prisma-outbox.repository.js";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";
import { PaymentApprovedHandler } from "../src/modules/checkout/application/handlers/payment-approved.handler.js";
import { CheckoutPaymentAdapter } from "../src/modules/payment/infrastructure/checkout-payment.adapter.js";
import { PaymentDispatchService } from "../src/modules/payment/application/services/payment-dispatch.service.js";
import { HandleAsaasWebhookUseCase } from "../src/modules/payment/application/handle-asaas-webhook.use-case.js";

// Signed real Meta ingress/worker/AppModule/SQL/Redis. Final WhatsApp/media
// transport is local. The final two financial companions use a controlled PSP
// port and synthetic approval evidence, never external delivery or a fake
// embed/native actor. They begin with a checkout produced by actual controls.
test("T46", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createNativeServiceJourneyFixture({ bookingAwaitTrace: true, localModelFailure: true, native18HttpFailures: true });
  const step = (state: Awaited<ReturnType<typeof f.state>>) => (state.view?.serviceBooking?.model as any)?.step;
  const body = (state: Awaited<ReturnType<typeof f.state>>) => state.view?.body ?? "";
  const noFinancialWrites = async (c: NativeJourneyCase) => {
    const value = await f.snapshot(c); assert.equal(value.appointments.length, 0); assert.equal(value.payments.length, 0);
    assert.equal(value.audits.length, 0); assert.equal(value.orders, 0); assert.equal(value.inventory, 0);
  };
  const prepare = async (c: NativeJourneyCase) => { await f.review(c); return f.choose(c, "continue"); };
  try {
    await t.test("first contact creates the canonical phone-only account without asking for an existing email or creating a booking", async () => {
      const c = await f.make("first-contact", { guest: true }), wire = f.wire(c, "/servicos");
      await f.post(wire, false); assert.equal(await f.prisma.whatsAppWebhookInbox.count({ where: { eventId: wire.eventId } }), 0);
      assert.equal(await f.prisma.buyerIdentity.count({ where: { merchantId: c.merchantId } }), 0);
      await f.message(c, "/servicos"); const state = await f.state(c); assert.equal(step(state), "services");
      assert.doesNotMatch(body(state), /informe o e-mail|email.*j[aá].*utiliza|confirme.*e-mail/i);
      const identity = await f.prisma.buyerIdentity.findUniqueOrThrow({ where: { merchantId_identityKey: { merchantId: c.merchantId, identityKey: "phone:" + c.phone } } });
      const account = await f.prisma.buyerAccount.findUniqueOrThrow({ where: { globalUserId: identity.globalUserId } });
      assert.equal(account.email, "phone_" + c.phone + "@buyer.aacp"); assert.equal(account.passwordHash, null);
      assert.ok(account.phone?.startsWith("pii_v1:")); assert.ok(account.phoneLookupHash);
      assert.equal(await f.prisma.checkoutSession.count({ where: { merchantId: c.merchantId } }), 0);
      await noFinancialWrites(c);
    });
    await t.test("registered encrypted contact is recognized and a real slot click only presents a review", async () => {
      const c = await f.make("encrypted-contact"); await f.review(c);
      const state = await f.state(c); assert.equal(step(state), "review");
      assert.ok(Object.values(state.selections ?? {}).some(action => f.operation(action, "continue")));
      assert.equal(await f.prisma.checkoutSession.count({ where: { merchantId: c.merchantId } }), 0);
      assert.equal(await f.slots.get(c.merchantId, "not-a-checkout"), undefined); await noFinancialWrites(c);
      const session = await f.read(c); assert.equal(session.buyerPhone, c.phone, "canonical WA session stores the normalized routing phone, not account PII ciphertext");
    });
    await t.test("real separate current prepare and confirmation register one unpaid attendance and preserve native provenance", async () => {
      const c = await f.make("local-success"), prepared = await prepare(c); assert.equal(step(prepared.state), "prepared");
      await noFinancialWrites(c); const row = await f.checkout(c), before = readStoredServiceOrigin(row);
      assert.equal(before, "whatsapp"); assert.equal(row.globalUserId, c.buyerId);
      assert.equal((row.customer as any).phone_verified, true); assert.equal((row.customer as any).email_verified, false);
      const confirmed = await f.choose(c, "confirm"); assert.equal(step(confirmed.state), "confirmed");
      const result = await f.snapshot(c); assert.equal(result.appointments.length, 1); assert.equal(result.appointments[0]!.origin, "whatsapp");
      assert.equal(result.appointments[0]!.buyerGlobalUserId, c.buyerId); assert.equal(result.appointments[0]!.operationalStatus, "scheduled");
      assert.equal(result.appointments[0]!.payments.length, 1); assert.equal(result.appointments[0]!.payments[0]!.status, "pending");
      assert.equal(result.appointments[0]!.payments[0]!.mode, "at_attendance"); assert.equal(result.appointments[0]!.payments[0]!.amountCents, 5000);
      assert.equal(result.payments.length, 0); assert.equal(result.orders, 0); assert.equal(result.inventory, 0);
      assert.equal(readStoredServiceOrigin(await f.checkout(c)), before);
      assert.ok(result.events.some(event => event.eventType === "service.appointment.scheduled"));
      const parent = await f.prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: row.cart && (row.cart as any).cart_ref } } });
      assert.deepEqual(parent.items, []);
    });
    await t.test("guest contact collection stays in WhatsApp then presents a distinct confirmation without address or email OTP", async () => {
      const c = await f.make("guest-contacts", { guest: true }); await prepare(c);
      const before = await f.checkout(c); assert.equal((before.customer as any).fullName ?? undefined, undefined);
      assert.equal((before.customer as any).email ?? undefined, undefined); assert.equal(await f.prisma.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 0);
      await f.message(c, "guest-contacts@native-buyer.example.test"); await f.message(c, "Meu nome é Cliente Sintético");
      const state = await f.state(c), row = await f.checkout(c); assert.equal(step(state), "prepared");
      assert.equal((row.customer as any).email, "guest-contacts@native-buyer.example.test"); assert.match((row.customer as any).fullName, /Cliente/);
      assert.equal((row.customer as any).email_verified, false); assert.equal((row.customer as any).phone_verified, true);
      assert.doesNotMatch(body(state), /CEP|c[oó]digo.*e-mail|OTP|continuar.*site|Stripe/i); await noFinancialWrites(c);
      await f.choose(c, "confirm"); assert.equal((await f.snapshot(c)).appointments.length, 1);
    });
    await t.test("voice can choose a current slot but cannot continue or confirm a booking", async () => {
      const c = await f.make("voice-selection"); await f.review(c, { voice: true }); await noFinancialWrites(c);
      let state = await f.state(c); assert.ok(f.operation(state.numericSelections![0]!, "continue"));
      await f.message(c, "1002", { audio: true }); assert.equal(await f.prisma.checkoutSession.count({ where: { merchantId: c.merchantId } }), 0);
      assert.equal(step(await f.state(c)), "review"); await f.choose(c, "continue");
      state = await f.state(c); assert.ok(f.operation(state.numericSelections![0]!, "confirm"));
      await f.message(c, "1002", { audio: true }); assert.equal(step(await f.state(c)), "prepared"); await noFinancialWrites(c);
      assert.ok(f.runtime.whatsapp.events().some((event: any) => event.kind === "voiceInterpret"));
    });
    await t.test("two tenants and a product company keep catalogue boundaries and original product controls", async () => {
      const a = await f.make("tenant-a"), b = await f.make("tenant-b"), p = await f.make("product-company", { mode: "products" });
      await f.message(a, "/servicos"); const foreign = await f.control(a, action => f.operation(action, "offer"));
      await f.message(b, "/servicos"); await f.message(b, "Foreign selection", { interactiveId: foreign.id });
      assert.notEqual(step(await f.state(b)), "professionals"); await noFinancialWrites(a); await noFinancialWrites(b);
      await f.message(p, "/produtos"); const state = await f.state(p);
      assert.equal(state.view?.serviceBooking, undefined);
      assert.equal(Object.values(state.selections ?? {}).some(action => action.kind === "service_booking"), false);
      assert.ok(Object.values(state.selections ?? {}).some(action => action.kind === "tool"));
      assert.equal(await f.prisma.productStock.count({ where: { variantId: p.variantId, quantity: 10, reserved: 0 } }), 1); await noFinancialWrites(p);
    });
    await t.test("actual current page/back/menu controls do not replay business writers", async () => {
      const c = await f.make("native-navigation"); await f.message(c, "/servicos"); await f.choose(c, "offer"); await f.choose(c, "professional");
      const first = await f.state(c), page = Object.values(first.selections ?? {}).find(action => f.operation(action, "page")) as any;
      assert.ok(page); await f.choose(c, "page", action => action.page === page.page);
      assert.equal((await f.state(c)).page, page.page);
      const back = await f.control(c, action => f.operation(action, "back") && (action as any).target === "professionals");
      await f.message(c, "Profissionais", { interactiveId: back.id }); assert.equal(step(await f.state(c)), "professionals");
      const menu = await f.control(c, action => action.kind === "menu");
      await f.message(c, "Menu principal", { interactiveId: menu.id }); const state = await f.state(c);
      assert.ok(state.view?.blocks.some(block => block.type === "buyer_hub_actions" && block.data.scope === "main_menu"));
      await noFinancialWrites(c);
    });
    await t.test("native human support uses the existing canonical handoff while preserving service selection", async () => {
      const c = await f.make("native-human"); await f.review(c); const source = await f.state(c);
      const human = await f.control(c, action => action.kind === "message" && action.message === "Falar com atendente");
      await f.message(c, "Falar com atendente", { interactiveId: human.id }); const session = await f.read(c);
      const binding = await f.prisma.whatsAppHandoffBinding.findFirstOrThrow({ where: { merchantId: c.merchantId, whatsappSessionId: session.id } });
      assert.equal(binding.mode, "waiting_human"); assert.ok(binding.ticketId);
      assert.equal((session.conversationState as any).conversationId, source.conversationId); await noFinancialWrites(c);
    });
    await t.test("old and duplicate buttons cannot prepare or confirm an extra appointment", async () => {
      const c = await f.make("stale-button"); await f.review(c); const old = await f.control(c, action => f.operation(action, "continue"));
      const prepared = await f.message(c, "Continuar", { interactiveId: old.id }); assert.equal(step(prepared.state), "prepared");
      const confirm = await f.control(c, action => f.operation(action, "confirm")), event = f.wire(c, "Confirmar", { interactiveId: confirm.id });
      const first = await f.post(event); assert.equal(first!.status, "processed"); const before = await f.snapshot(c);
      assert.equal(before.appointments.length, 1); await f.post(event); assert.deepEqual(await f.snapshot(c), before);
      await f.message(c, "Old confirm", { interactiveId: confirm.id }); assert.deepEqual(await f.snapshot(c), before);
      await f.message(c, "Old continue", { interactiveId: old.id }); assert.deepEqual(await f.snapshot(c), before);
      assert.equal(await f.prisma.whatsAppWebhookInbox.count({ where: { eventId: event.eventId } }), 1);
    });
    await t.test("policy change between current review and prepare leaves no partial checkout or appointment", async () => {
      const c = await f.make("policy-change"); await f.review(c); const picked = await f.control(c, action => f.operation(action, "continue"));
      await f.prisma.serviceBusinessPolicy.update({ where: { merchantId: c.merchantId }, data: { version: { increment: 1 }, admissionsEnabled: false } });
      const result = await f.post(f.wire(c, "Continuar", { interactiveId: picked.id })); assert.ok(result);
      await noFinancialWrites(c); assert.equal(await f.prisma.checkoutSession.count({ where: { merchantId: c.merchantId } }), 0);
      assert.notEqual(step(await f.state(c)), "confirmed");
    });
    await t.test("hold-on preparation uses actual Redis while hold-off confirmation still occupies the confirmed slot", async () => {
      const c = await f.make("held-success", { hold: true }); await prepare(c); const row = await f.checkout(c);
      const held = await f.slots.get(c.merchantId, row.sessionId); assert.ok(held); assert.equal(held.slots.length, 1);
      assert.equal(held.slots[0]!.resourceId, "professional:" + c.professionalId); assert.ok(Date.parse(held.expiresAt) > Date.now());
      await noFinancialWrites(c); await f.choose(c, "confirm"); const appointments = (await f.snapshot(c)).appointments;
      assert.equal(appointments.length, 1); assert.equal(appointments[0]!.operationalStatus, "scheduled");
    });
    await t.test("expired Redis lease cannot be replaced or confirmed by the old current confirmation button", async () => {
      const c = await f.make("hold-expired", { hold: true }); await prepare(c); const row = await f.checkout(c), key = f.slots.checkoutKey(c.merchantId, row.sessionId);
      const original = await f.redis.get(key); assert.ok(original); const stored = JSON.parse(original), now = await f.redis.time();
      stored.expiresAt = Number(now[0]) * 1000 + Math.floor(Number(now[1]) / 1000) - 1;
      await f.redis.set(key, JSON.stringify(stored), "KEEPTTL");
      for (const slot of stored.slots) await f.redis.hset(f.slots.resourceKey(c.merchantId, slot.resourceId), stored.owner, JSON.stringify(stored));
      const confirm = await f.control(c, action => f.operation(action, "confirm"));
      await f.post(f.wire(c, "Confirmar", { interactiveId: confirm.id })); await noFinancialWrites(c);
      assert.equal(await f.slots.get(c.merchantId, row.sessionId), undefined); assert.notEqual(step(await f.state(c)), "confirmed");
    });
    await t.test("two actual buyers with hold-off prepared summaries cannot both confirm the same slot", async () => {
      const a = await f.make("double-booking"), b = await f.secondBuyer(a);
      assert.deepEqual([b.merchantId, b.configId, b.deviceId, b.productId, b.variantId, b.professionalId],
        [a.merchantId, a.configId, a.deviceId, a.productId, a.variantId, a.professionalId]);
      assert.ok(a.buyerId && b.buyerId && a.buyerId !== b.buyerId && a.phone !== b.phone, "the race requires distinct real buyers");
      assert.equal((await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: a.merchantId } })).holdEnabled, false);
      const prepareContender = async (c: NativeJourneyCase, target?: ProfessionalCheckoutSelection) => {
        await f.message(c, "/servicos");
        await f.choose(c, "offer", action => action.productId === c.productId && action.variantId === c.variantId);
        await f.choose(c, "professional", action => action.professionalId === c.professionalId);
        const dates = Object.values((await f.state(c)).selections ?? {}).filter(action => f.operation(action, "date"));
        const offeredDates = [...new Set(dates.map(action => (action as any).date as string))].sort();
        // The first current date may be today. Choose a strictly later actual
        // menu date, so processing time cannot move either buyer to a new slot.
        const date = target?.date ?? offeredDates.find(value => value > offeredDates[0]!);
        assert.ok(date && offeredDates.includes(date), "the contender's exact future date must be offered by the real menu");
        await f.choose(c, "date", action => action.date === date);
        const choices = ((await f.state(c)).numericSelections ?? []).filter(action => f.operation(action, "slot"));
        const offered = choices.map(action => (action as any).selection as ProfessionalCheckoutSelection);
        const selected = target ? offered.find(value => isDeepStrictEqual(value, target)) : offered[0];
        assert.ok(selected, "hold-off contenders must be offered the identical current canonical slot");
        await f.choose(c, "slot", action => isDeepStrictEqual(action.selection, selected));
        assert.equal(step(await f.state(c)), "review");
        const prepared = await f.choose(c, "continue"), model = prepared.state.view?.serviceBooking?.model as any;
        assert.equal(step(prepared.state), "prepared"); assert.equal(model.source.payment_mode, "at_attendance");
        assert.equal(model.source.requires_hold, false); assert.equal(model.source.selections.length, 1);
        const row = await f.checkout(c), selections = readProfessionalCheckoutSelections(await f.canonicalCheckout(c));
        assert.equal(row.merchantId, c.merchantId); assert.equal(row.globalUserId, c.buyerId);
        assert.equal(model.source.session_id, row.sessionId); assert.equal(selections.length, 1);
        assert.deepEqual(selections[0], selected, "the stored prepared checkout must retain the exact real menu tuple");
        assert.deepEqual([selections[0]!.productId, selections[0]!.variantId, selections[0]!.professionalId],
          [c.productId, c.variantId, c.professionalId]);
        return { row, selection: selections[0]! };
      };
      const ap = await prepareContender(a), bp = await prepareContender(b, ap.selection);
      assert.notEqual(ap.row.sessionId, bp.row.sessionId); assert.notEqual(ap.row.globalUserId, bp.row.globalUserId);
      assert.deepEqual(bp.selection, ap.selection, "both real prepared checkouts must compete for one byte-exact canonical tuple");
      assert.equal((await f.snapshot(a)).appointments.length, 0, "neither preparation may already admit an appointment");
      const ac = await f.control(a, action => f.operation(action, "confirm")), bc = await f.control(b, action => f.operation(action, "confirm"));
      await Promise.all([f.post(f.wire(a, "Confirmar", { interactiveId: ac.id })), f.post(f.wire(b, "Confirmar", { interactiveId: bc.id }))]);
      const result = await f.snapshot(a); assert.equal(result.appointments.length, 1); assert.equal(result.appointments[0]!.payments.length, 1);
      assert.equal(result.payments.length, 0); assert.equal(result.inventory, 0);
      assert.equal([step(await f.state(a)), step(await f.state(b))].filter(value => value === "confirmed").length, 1);
    });
    await t.test("source-cart edits made after the prepared summary survive confirmation of the immutable checkout", async () => {
      const c = await f.make("source-edit"); await prepare(c); const row = await f.checkout(c), cartRef = (row.cart as any).cart_ref;
      const parent = await f.prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: cartRef } } });
      const items = [...parent.items as any[], { variantId: c.variantId, productId: c.productId, sku: "later-owned-edit", name: "Later owned source edit",
        quantity: 1, unitPriceCents: 5000 }];
      await f.prisma.storefrontCart.update({ where: { id: parent.id }, data: { items, total: parent.total + 5000 } });
      const before = await f.prisma.storefrontCart.findUniqueOrThrow({ where: { id: parent.id } }); await f.choose(c, "confirm");
      assert.equal((await f.snapshot(c)).appointments.length, 1);
      assert.deepEqual(await f.prisma.storefrontCart.findUniqueOrThrow({ where: { id: parent.id } }), before);
    });
    await t.test("an unresolved journal committed ahead of a waiting native confirmation blocks it and remains intact", async () => {
      const c = await f.make("active-money"); await prepare(c); const row = await f.checkout(c), summary = await f.canonicalCheckout(c);
      // Owned historical financial precondition, not a productive write route:
      // commit it under the same merchant lock ahead of the actual waiter.
      let release!: () => void, locked!: () => void, failLock!: (error: unknown) => void, holderPid = 0, finished = false;
      const gate = new Promise<void>(resolve => { release = resolve; }), hasLock = new Promise<void>((resolve, reject) => { locked = resolve; failLock = reject; });
      let intent: Awaited<ReturnType<typeof f.prisma.paymentIntent.create>> | undefined;
      const holder = f.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${c.merchantId} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; locked(); await gate;
        intent = await tx.paymentIntent.create({ data: { id: "historical", merchantId: c.merchantId, sessionId: row.sessionId, idempotencyKey: "t46-historical-active",
        amountCents: 5000, currency: "BRL", method: "pix", status: "pending", creation: { state: "in_flight", firstAttemptAt: new Date().toISOString(),
          input: { merchantId: c.merchantId, sessionId: row.sessionId, intentId: "historical", provider: "asaas", method: "pix", amountCents: 5000, currency: "BRL" } },
        amountBreakdown: { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(summary), itemsSubtotalCents: 5000, discountCents: 0, shippingCents: 0, platformFeeCents: 0, totalCents: 5000 } } });
      }, { timeout: 15_000 }); void holder.catch(failLock);
      let pending: ReturnType<typeof f.post> | undefined;
      try {
        await hasLock; const current = await f.control(c, action => f.operation(action, "confirm"));
        pending = f.post(f.wire(c, "Confirmar", { interactiveId: current.id })).finally(() => { finished = true; }); void pending.catch(() => {});
        await f.wait(async () => {
          const rows = await f.prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query ILIKE '%merchants%' AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
          return rows.length > 0 ? true : undefined;
        }, "native_confirmation_must_wait_for_actual_merchant_lock");
        assert.equal(finished, false); release(); await holder; await pending;
        const result = await f.snapshot(c); assert.equal(result.appointments.length, 0); assert.equal(result.audits.length, 0); assert.equal(result.orders, 0);
        assert.ok(intent); assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }), intent);
      } finally { release(); await Promise.allSettled([holder, ...(pending ? [pending] : [])]); }
    });

    for (const inFlight of [false, true]) await t.test(inFlight ? "canonical in-flight payment may finish after its native turn and policy window end" : "canonical late Pix approval preserves the real native checkout origin after the original turn ends", async () => {
      const c = await f.make(inFlight ? "in-flight" : "late-pix", { online: true }); await prepare(c); const row = await f.checkout(c);
      assert.equal(readStoredServiceOrigin(row), "whatsapp"); assert.equal(currentWhatsAppExecution(), undefined);
      const nativeState = await f.state(c); assert.equal(Object.values(nativeState.selections ?? {}).some(action => f.operation(action, "confirm")), false);
      assert.ok(Object.values(nativeState.selections ?? {}).some(action => action.kind === "tool" && ["create_payment", "open_payment_checkout"].includes(action.tool)));
      const originalProvenance = (row as any).serviceOriginProof, session = await f.canonicalCheckout(c), repository = new PrismaPaymentRepository(f.prisma, captureStorefrontCouponForPayment, undefined, undefined, () => f.slots);
      const checkout = new PrismaCheckoutRepository(f.prisma), holds = new ServiceSlotHoldsService(f.prisma, f.slots);
      const intent = PaymentIntentEntity.create({ merchantId: c.merchantId, sessionId: row.sessionId, idempotencyKey: "t46-" + row.sessionId,
        amountCents: 5000, currency: "BRL", method: "pix", amountBreakdown: { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(session),
          itemsSubtotalCents: 5000, discountCents: 0, shippingCents: 0, platformFeeCents: 0, totalCents: 5000 } });
      intent.prepareCreation({ merchantId: c.merchantId, sessionId: row.sessionId, intentId: intent.id, provider: "asaas", amountCents: 5000, currency: "BRL",
        method: "pix", asaasCustomerId: "synthetic-customer", providerIdempotencyKey: "t46-" + row.sessionId }); await repository.saveIntent({ intent });
      let requests = 0, release!: () => void;
      const ready = new Promise<void>(resolve => { release = resolve; });
      const resume = new ResumePaymentCreationService(repository, { createPayment: async () => { requests++; if (inFlight) await ready;
        return { providerPaymentId: "synthetic-provider-" + intent.id, buyerFacingPayload: { qrCodeCopyPaste: "SYNTHETIC-NONPAYABLE-PIX" } }; } }, holds, checkout);
      let pending: ReturnType<typeof resume.execute> | undefined;
      try {
        pending = resume.execute(intent); void pending.catch(() => {}); await f.wait(async () => requests === 1 ? true : undefined, "native_financial_companion_not_dispatched");
        assert.equal(currentWhatsAppExecution(), undefined);
        if (inFlight) {
          const active = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }); assert.equal((active.creation as any).state, "in_flight");
          await f.prisma.serviceBusinessPolicy.update({ where: { merchantId: c.merchantId }, data: { version: { increment: 1 }, admissionsEnabled: false, paymentMode: "at_attendance" } });
        }
        release(); const submitted = await pending; assert.equal(submitted.status, "requires_action"); assert.equal(requests, 1);
        // End the original conversation and inbox service window. Financial
        // continuation is tied to persisted checkout/payment provenance only.
        const wa = await f.read(c); await f.prisma.whatsAppSession.update({ where: { id: wa.id }, data: { status: "expired", lastActivityAt: new Date(0) } });
        await f.prisma.whatsAppWebhookInbox.updateMany({ where: { merchantId: c.merchantId }, data: { leaseToken: null, leaseExpiresAt: null } });
        const bus = new InMemoryDomainEventBus(), complete = new CompleteOrderUseCase(checkout, checkout, checkout, undefined, undefined, undefined, undefined, checkout,
          undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(f.prisma));
        new PaymentApprovedHandler(bus, complete).onModuleInit();
        const paymentCheckout = new CheckoutPaymentAdapter(checkout, new PrismaOutboxRepository(f.prisma), bus, f.prisma);
        const hook = new HandleAsaasWebhookUseCase(repository, new PaymentDispatchService(repository, paymentCheckout), undefined, f.prisma);
        const token = "synthetic-private-webhook-token", payload = { id: "native-late-" + randomUUID(), event: "PAYMENT_RECEIVED",
          payment: { id: submitted.providerPaymentId!, value: 50, externalReference: intent.id } };
        await assert.rejects(hook.execute("wrong", payload, token), /asaas_webhook_token_invalid/);
        assert.equal((await hook.execute(token, payload, token)).outcome, "processed"); assert.deepEqual(await hook.execute(token, payload, token), { outcome: "duplicate" });
        const paid = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }); assert.equal(paid.status, "approved"); assert.equal(paid.approvedAmountCents, 5000);
        const order = await f.wait(() => f.prisma.completedOrder.findFirst({ where: { merchantId: c.merchantId, sessionId: row.sessionId } }), "native_origin_paid_order_missing");
        assert.equal(order.orderTotal.eq(50), true); assert.equal(readStoredServiceOrigin(await f.prisma.checkoutSession.findUniqueOrThrow({ where: { id: row.id } })), "whatsapp");
        assert.deepEqual((await f.prisma.checkoutSession.findUniqueOrThrow({ where: { id: row.id } }) as any).serviceOriginProof, originalProvenance);
        if (inFlight) {
          const warning = await f.wait(() => f.prisma.merchantNotification.findFirst({ where: { merchantId: c.merchantId, type: "service_payment_regularization" } }), "native_paid_regularization_missing");
          assert.equal((warning.metadata as any).bookingConfirmed, false); assert.equal(await f.prisma.serviceAppointment.count({ where: { merchantId: c.merchantId } }), 0);
        } else {
          const appointment = await f.wait(() => f.prisma.serviceAppointment.findFirst({ where: { merchantId: c.merchantId, orderId: order.id } }), "native_paid_appointment_missing");
          assert.equal(appointment.origin, "whatsapp"); assert.equal(appointment.operationalStatus, "scheduled"); assert.equal(appointment.buyerGlobalUserId, row.globalUserId);
          assert.equal(await f.prisma.appointmentPayment.count({ where: { appointmentId: appointment.id, paymentIntentId: intent.id, status: "approved", amountCents: 5000 } }), 1);
        }
        assert.equal(requests, 1); assert.equal(await f.prisma.paymentIntent.count({ where: { merchantId: c.merchantId } }), 1);
        assert.equal(await f.prisma.inventoryMovement.count({ where: { merchantId: c.merchantId } }), 0);
      } finally { release(); if (pending) await Promise.allSettled([pending]); }
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
