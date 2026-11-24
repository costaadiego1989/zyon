import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { withWhatsAppExecution } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { withNativeServiceBookingAuthority } from "../../../../shared/bookings/native-service-booking-authority.js";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { professionalScheduleSnapshot } from "../../../../shared/bookings/service-checkout-cart.js";
import { WhatsAppServiceBookingService } from "./whatsapp-service-booking.service.js";

function fixture() {
  const now = new Date("2030-01-01T12:00:00Z"), calls: any[] = [];
  const offer = { productId: "service", variantId: "variant", name: "Consulta canônica" }, person = { id: "professional", name: "Dra. Joana", version: 3 };
  const tuple = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 3, policyVersion: 2, date: "2030-01-02",
    startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
  const selected = { ...tuple, slotId: professionalSlotId("merchant", tuple) };
  const scope: any = { merchantId: "merchant", sessionId: "checkout", cartRef: "cart", expiresAtUnix: 2_000_000_000,
    buyer: { merchantId: "merchant", conversationId: "cart", globalUserId: "canonical-buyer", customer: { phone: "5511999991234", phone_verified: true, email_verified: false } } };
  const state: any = { version: 1, conversationId: "cart", revision: "revision", stage: "store", history: [], page: 0, previousViews: [],
    view: { serviceBooking: { model: { step: "slots", offer, professional: person, date: selected.date } } } };
  const context: any = { scope, state, now, uiBinding: { merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session", conversationId: "cart", validUntil: now.getTime() + 86_400_000 },
    turn: { message: "Agendar consulta", origin: "button", inboxId: "inbox", scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session" } } };
  const execution: any = Object.freeze({ authority: Object.freeze({ version: 1, merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session", inboxId: "inbox",
    bindingId: null, epoch: 0, deviceId: "META_CLOUD:config", buyerPhone: "+5511999991234", provider: "META_CLOUD", accountId: "account", checkoutSessionId: null, conversationId: "cart", revision: "revision" }),
    admitEffect: async () => {}, admitDelivery: async () => {}, startRequest: async (_scope: unknown, start: () => unknown) => start() });
  const authority: any = { run: async (input: any, work: (value: any) => unknown) => {
    const operation = input.action?.operation, gesture = context.turn.origin === "button" && ["continue", "confirm"].includes(operation) ? operation : undefined;
    return withWhatsAppExecution(execution, () => withNativeServiceBookingAuthority({ scope, execution, revalidate: async () => now, ...(gesture ? { gesture } : {}) }, () => work(context)));
  } };
  // This double exercises only resolved owners: both read and write entrypoints use the same existing private frame.
  authority.runRead = authority.run;
  let paymentMode = "at_attendance", productMode = "services", missingContact = false, failSelect = false, failure: Error | undefined;
  const policy = () => ({ version: 2, paymentMode, holdEnabled: false, holdMinutes: null });
  const row: any = { merchantId: "merchant", sessionId: "checkout", globalUserId: "canonical-buyer", conversationId: "checkout-conversation", createdAt: now, updatedAt: now,
    cart: { source: "storefront", cart_ref: "cart", currency: "BRL", total: 50, items: [{ variantId: "variant", product_id: "service", sku: "SKU", name: offer.name,
      quantity: 1, price: 50, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: professionalScheduleSnapshot(selected) }] },
    customer: { phone: "5511999991234", phone_verified: true, fullName: "Buyer", email: "buyer@example.test" }, shipping: null, abandonmentScore: 0, triggerAgent: false };
  const source: any = { items: [{ productId: "service", variantId: "variant", name: offer.name, sku: "SKU", quantity: 1, unitPriceCents: 5000,
    selectedServiceSlot: professionalScheduleSnapshot(selected) }], total: 5000, discount: 0, couponCode: null, freeShipping: false };
  const booking: any = {
    professionals: async (bound: unknown, args: unknown) => { calls.push(["professionals", bound, args]); return { professionals: [{ ...person, timeZone: "America/Sao_Paulo", profile: {} }], has_more: false }; },
    dates: async (bound: unknown, args: unknown) => { calls.push(["dates", bound, args]); return { dates: [selected.date], professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" }; },
    slots: async (bound: unknown, args: unknown) => { calls.push(["slots", bound, args]); return { selections: [selected] }; },
    select: async (bound: unknown, args: unknown) => { calls.push(["select", bound, args]); if (failSelect) throw new ConflictException("service_selection_stale"); return {
      selection: selected, service: { name: offer.name }, professional: { name: person.name }, parent_cart_fingerprint: "a".repeat(64), policy: policy() }; },
    prepare: async (bound: unknown, args: unknown) => { calls.push(["prepare", bound, args]); if (failure) throw failure; return { session_id: "checkout", cart_fingerprint: "b".repeat(64),
      payment_mode: paymentMode, policy_version: 2, requires_hold: false, service_slot_hold: null, selections: [{ ...selected, productName: offer.name, professionalName: person.name }], confirmed: false }; },
    reviewNativeCheckout: async () => { calls.push(["renew"]); },
  };
  const prisma: any = { merchant: { findUnique: async () => ({ businessMode: productMode, businessModeSelectedAt: now, businessModeNeedsReview: false }) },
    product: { findFirst: async () => ({ id: "service", name: offer.name }), findMany: async () => [{ id: "service", name: offer.name, variants: [{ id: "variant", sku: "SKU" }] }] },
    serviceProfessional: { findFirst: async () => ({ id: person.id, publicName: person.name, version: person.version }) },
    checkoutSession: { findUnique: async () => ({ ...row, customer: { ...row.customer, fullName: missingContact ? undefined : row.customer.fullName } }) },
    storefrontCart: { findUnique: async () => source }, $transaction: async () => { calls.push(["transaction"]); assert.fail("unexpected financial/summary transaction"); } };
  const service = new WhatsAppServiceBookingService(prisma, authority, booking, { isCommittedCheckout: async () => false, state: async () => ({ requires_hold: false, service_slot_hold: null }) } as never);
  const input: any = { merchantId: "merchant", state, buyer: { globalUserId: "attacker" }, verifiedSender: { inboxId: "inbox", leaseToken: "lease", deviceId: "META_CLOUD:config", fromNumber: "5511999991234" } };
  const render = async (next: any) => { calls.push(["render-checkout", next]); return { state: next, agentMessage: "Coleta/pagamento existentes", blocks: [], quickReplies: [] }; };
  const summary = () => ({ session_id: "checkout", cart_fingerprint: "b".repeat(64), payment_mode: paymentMode, policy_version: 2, requires_hold: false,
    service_slot_hold: null, selections: [{ ...selected, productName: offer.name, professionalName: person.name }] });
  return { service, input, context, calls, selected, offer, person, policy, render, summary,
    setPayment: (value: string) => { paymentMode = value; }, setMissing: () => { missingContact = true; }, setProduct: () => { productMode = "products"; },
    setStale: () => { failSelect = true; }, setFailure: (value: Error) => { failure = value; } };
}
test("T46 canonical native dispatch", async t => {
  await t.test("service and professional choices delegate canonical selectors using the server buyer", async () => {
    const f = fixture(); await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "offer", productId: "service", variantId: "variant", uiRevision: "revision" } }, f.render);
    assert.deepEqual(f.calls[0][2], { productId: "service", variantId: "variant" }); assert.equal(f.calls[0][1].buyer.globalUserId, "canonical-buyer");
    assert.equal(f.calls.some(call => ["prepare", "transaction", "render-checkout"].includes(call[0])), false);
  });
  await t.test("dated native choice checks the professional and policy versions before canonical slots", async () => {
    const f = fixture(); const response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "date", productId: "service", variantId: "variant",
      professionalId: "professional", professionalVersion: 3, policyVersion: 2, date: "2030-01-02", uiRevision: "revision" } }, f.render);
    assert.deepEqual(f.calls.map(call => call[0]), ["professionals", "dates", "slots"]); assert.equal(response!.state.serviceBooking!.model.step, "slots");
  });
  await t.test("slot selection rereads the exact tuple and produces review without a hold or confirmation", async () => {
    const f = fixture(), response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "slot", selection: f.selected, uiRevision: "revision" } }, f.render);
    assert.deepEqual(f.calls.map(call => call[0]), ["select"]); assert.equal(response!.state.serviceBooking!.model.step, "review");
    assert.equal(JSON.stringify(response).includes("parent_cart_fingerprint"), false);
  });
  await t.test("stale readonly selection returns a stale surface without preparation", async () => {
    const f = fixture(); f.setStale(); const response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "slot", selection: f.selected } }, f.render);
    assert.equal((response!.state.serviceBooking!.model as any).reason, "stale"); assert.equal(f.calls.some(call => call[0] === "prepare"), false);
  });
  await t.test("real continuation prepares once and keeps confirmation as a separate native action", async () => {
    const f = fixture(), response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "continue", selection: f.selected, uiRevision: "revision" } }, f.render);
    assert.deepEqual(f.calls.map(call => call[0]), ["select", "prepare"]); assert.equal(response!.state.serviceBooking!.model.step, "prepared");
    assert.equal(f.calls.some(call => call[0] === "transaction"), false); assert.equal(response!.state.checkoutSessionId, "checkout");
  });
  await t.test("missing contact data returns to the existing collector and does not confirm", async () => {
    const f = fixture(); f.setMissing(); const response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "continue", selection: f.selected } }, f.render);
    assert.equal(response!.agentMessage, "Coleta/pagamento existentes"); assert.equal(f.calls.filter(call => call[0] === "render-checkout").length, 1);
    assert.equal(f.calls.some(call => call[0] === "transaction"), false);
  });
  await t.test("online continuation uses existing Pix/card checkout and never local confirmation", async () => {
    const f = fixture(); f.setPayment("online"); const response = await f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "continue", selection: f.selected } }, f.render);
    assert.equal(response!.agentMessage, "Coleta/pagamento existentes"); assert.equal(f.calls.some(call => call[0] === "transaction"), false);
  });
  await t.test("voice/text continuation has no private gesture and cannot prepare", async () => {
    for (const origin of ["voice", "text"]) {
      const f = fixture(); f.context.turn.origin = origin;
      await assert.rejects(f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "continue", selection: f.selected } }, f.render), /whatsapp_service_button_required/);
      assert.deepEqual(f.calls, []);
    }
  });
  await t.test("unknown preparation outcome is propagated without retry, renewal or false confirmation", async () => {
    const f = fixture(), error = new Error("unknown-commit-outcome"); f.setFailure(error);
    await assert.rejects(f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "continue", selection: f.selected } }, f.render), value => value === error);
    assert.deepEqual(f.calls.map(call => call[0]), ["select", "prepare"]);
  });
  await t.test("product mode keeps the original menu and never advertises native service tools", async () => {
    const f = fixture(); f.setProduct(); const original: any = { state: f.input.state, agentMessage: "Original", quickReplies: ["Ver produtos"], blocks: [{ type: "buyer_hub_actions", data: { scope: "main_menu" } }] };
    assert.equal(await f.service.decorateMenu("merchant", original), original);
    assert.equal(await f.service.storeBinding(f.input).factory({ merchantId: "merchant", conversationId: "cart", cartRef: "cart" }), undefined);
    assert.deepEqual(f.calls, []);
  });
  await t.test("text/voice semantic resolver uses private native reads and returns only a proposal", async () => {
    const f = fixture(); f.context.turn.origin = "voice"; const binding = f.service.storeBinding(f.input);
    const tools = await binding.factory({ merchantId: "merchant", conversationId: "cart", cartRef: "cart" }); assert.ok(tools);
    const result = await tools.resolveServiceSelection({ productId: "service", variantId: "variant", professionalName: "Dra. Joana", date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } });
    assert.equal(result.kind, "selection"); const response = await binding.present({ blocks: [{ type: "service_booking", data: result }] });
    assert.equal(response!.state.serviceBooking!.model.step, "review"); assert.equal(f.calls.some(call => call[0] === "prepare"), false);
    assert.equal(JSON.stringify(response).includes("canonical-buyer"), false);
  });
  await t.test("confirmation also rejects voice before reaching its transaction", async () => {
    const f = fixture(); f.context.turn.origin = "voice"; f.context.state.view.serviceBooking.model = { step: "prepared", offer: f.offer, source: f.summary() };
    await assert.rejects(f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "confirm" } }, f.render), /whatsapp_service_button_required/);
    assert.deepEqual(f.calls, []);
  });
  await t.test("an online-policy summary cannot reach the local confirmation writer even with a controlled valid button", async () => {
    const f = fixture(); f.setPayment("online"); f.context.state.view.serviceBooking.model = { step: "prepared", offer: f.offer, source: f.summary() };
    await assert.rejects(f.service.respond({ ...f.input, action: { kind: "service_booking", operation: "confirm" } }, f.render), /service_confirmation_summary_changed/);
    assert.deepEqual(f.calls, []);
  });
});
