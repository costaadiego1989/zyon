import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";
import { WhatsAppTurnContext } from "../../domain/services/whatsapp-turn-context.js";
import { buildMetaUiView, presentMetaUi } from "../../domain/ui/meta-ui-renderer.js";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";

function fixture(model?: unknown) {
  const emitted: any[] = [], legacy: any[] = [], services: any[] = [], human: string[] = [];
  const now = Date.now(), binding = { merchantId: "merchant", configId: "config", whatsappSessionId: "session", conversationId: "conversation", validUntil: now + 60_000 };
  const offer = { productId: "service", variantId: "variant", name: "Consulta de orientação" };
  const raw = { binding, model: model ?? { step: "services", offers: Array.from({ length: 13 }, (_, i) => ({ ...offer, productId: "service-" + i, variantId: "variant-" + i })), hasMore: false } };
  const state: any = { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "visible", page: 0, previousViews: [], serviceBooking: raw };
  const view = buildMetaUiView({ state, agentMessage: "", blocks: [{ type: "service_booking_controls", data: {} }], quickReplies: [] });
  const presentation = presentMetaUi(view, state.revision); Object.assign(state, { view, selections: presentation.selections, numericSelections: presentation.numericSelections });
  const session: any = { id: "session", conversationState: state }, claim: any = { id: "new-inbox", merchantId: "merchant", leaseToken: "existing-lease" };
  const input: any = { merchantId: "merchant", provider: "META_CLOUD", deviceId: "META_CLOUD:config", fromNumber: "5511999991234", body: "", timestamp: now, inboxClaim: claim };
  const route: any = { whatsappSession: session, buyerData: { globalUserId: "buyer", phone: input.fromNumber } };
  const context = new WhatsAppTurnContext(), turn: any = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "session" },
    conversationId: "conversation", inboxId: claim.id, leaseToken: claim.leaseToken, message: "Escolher", origin: "button" };
  const conversation: any = { respondStore: async (value: unknown) => { legacy.push(value); assert.fail("service action reached the legacy product/checkout adapter"); },
    respondServiceBooking: async (value: any) => { services.push(value); return { agentMessage: "", quickReplies: [], blocks: [{ type: "service_booking_controls", data: {} }],
      state: { ...value.state, serviceBooking: { binding, model: { step: "status", reason: "read_failed" } } } }; } };
  const inbox: any = { saveResponse: async (_: unknown, value: unknown) => { claim.responseState = structuredClone(value); return true; } };
  const sessions: any = { update: async (_: unknown, value: any) => Object.assign(session, value) };
  const sender: any = { sendUi: async (value: any) => { emitted.push(value.uiMessage); return { status: "sent", messageId: "synthetic-" + emitted.length }; } };
  const intake: any = { requestSelectedHumanAction: async () => { human.push("selected"); return { confirmed: true, reply: "Atendimento solicitado.", ticketId: "ticket", bindingId: "binding", epoch: 1 }; }, takeNotice: () => undefined };
  const choose = (predicate: (action: any) => boolean) => { const entry = Object.entries(session.conversationState.selections).find(([, action]) => predicate(action)); assert.ok(entry); input.interactiveId = entry[0]; };
  const execute = () => context.run(turn, () => new HandleMetaConversationUseCase(conversation, sessions, inbox, sender,
    undefined, undefined, undefined, intake, undefined, context).execute(input, route));
  return { emitted, legacy, services, human, raw, state, session, input, claim, route, turn, conversation, inbox, choose, execute };
}
test("T44 native service action isolation", async t => {
  await t.test("a current service action reaches only the separate typed server dispatcher with existing sender proof", async () => {
    const f = fixture(); f.choose(a => a.kind === "service_booking" && a.operation === "offer"); await f.execute();
    assert.equal(f.services.length, 1); assert.deepEqual(f.legacy, []);
    assert.deepEqual(f.services[0].verifiedSender, { inboxId: f.claim.id, leaseToken: "existing-lease", deviceId: "META_CLOUD:config", fromNumber: f.input.fromNumber });
    assert.equal(f.services[0].messageId, f.claim.id);
    assert.equal(f.services[0].action.uiRevision, "visible"); assert.equal(f.session.conversationState.numericSelections.some((a: any) => a.kind === "tool"), false);
  });
  await t.test("service pagination stays local, rebinds native actions to the new revision and does not extend freshness", async () => {
    const f = fixture(); f.choose(a => a.kind === "service_booking" && a.operation === "page"); await f.execute();
    assert.deepEqual(f.services, []); assert.deepEqual(f.legacy, []); assert.equal(f.session.conversationState.page, 1);
    assert.equal(f.session.conversationState.view.serviceBooking.binding.validUntil, f.raw.binding.validUntil);
    for (const a of f.session.conversationState.numericSelections) if (a.kind === "service_booking") assert.equal(a.uiRevision, f.claim.id);
    assert.ok(f.session.conversationState.numericSelections.length <= 10);
  });
  await t.test("a missing T46 dispatcher produces an unavailable state and never falls back to product or payment tools", async () => {
    const f = fixture(); delete f.conversation.respondServiceBooking; f.choose(a => a.kind === "service_booking" && a.operation === "offer"); await f.execute();
    assert.deepEqual(f.legacy, []); assert.deepEqual(f.services, []);
    assert.equal(f.session.conversationState.numericSelections.some((a: any) => a.kind === "service_booking"), false);
    assert.equal(JSON.stringify(f.emitted).includes("Não consegui consultar"), true);
  });
  await t.test("archived generic navigation cannot restore a cached service availability view", async () => {
    const f = fixture(); f.input.interactiveId = "archived-id";
    f.inbox.findPriorSelection = async () => ({ action: { kind: "page", page: 1 }, view: f.state.view, conversationId: "conversation", selectionSent: true });
    await f.execute(); assert.deepEqual(f.services, []); assert.deepEqual(f.legacy, []);
    assert.equal(f.session.conversationState.page, 0);
  });
  await t.test("the fixed human control uses the existing selected-human intake without invoking a service or commerce writer", async () => {
    const f = fixture(); f.choose(a => a.kind === "message" && a.message === "Falar com atendente"); await f.execute();
    assert.deepEqual(f.human, ["selected"]); assert.deepEqual(f.legacy, []); assert.deepEqual(f.services, []);
    assert.equal(JSON.stringify(f.emitted).includes("Atendimento solicitado."), true);
  });
  await t.test("a voice-origin continuation never reaches the scheduling dispatcher", async () => {
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), startsAt = date + "T13:00:00.000Z";
    const tuple = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 1, policyVersion: 1,
      date, startsAt, endsAt: date + "T13:30:00.000Z", durationMinutes: 30, timeZone: "America/Sao_Paulo", priceInCents: 5000, currency: "BRL" };
    const f = fixture({ step: "review", offer: { productId: "service", variantId: "variant", name: "Consulta" }, source: { kind: "selection",
      selection: { ...tuple, slotId: professionalSlotId("merchant", tuple) }, serviceName: "Consulta", professionalName: "Profissional",
      policy: { version: 1, paymentMode: "online", holdEnabled: false, holdMinutes: null }, action: "review_service_booking",
      requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } });
    f.choose(a => a.kind === "service_booking" && a.operation === "continue"); f.turn.origin = "voice"; await f.execute();
    assert.deepEqual(f.services, []); assert.deepEqual(f.legacy, []);
    assert.equal(f.session.conversationState.numericSelections.some((a: any) => a.kind === "service_booking" && a.operation === "continue"), true);
    assert.equal(JSON.stringify(f.emitted).includes("toque em"), true);
  });
  await t.test("a current action from a different verified configuration is rejected before dispatch", async () => {
    const f = fixture(); f.choose(a => a.kind === "service_booking" && a.operation === "offer"); f.turn.scope.configId = "foreign"; await f.execute();
    assert.deepEqual(f.services, []); assert.deepEqual(f.legacy, []);
  });
  await t.test("a unique current service label keeps text selection on the typed reader path", async () => {
    const f = fixture({ step: "services", offers: [{ productId: "service", variantId: "variant", name: "Consulta de orientação" }], hasMore: false });
    f.input.body = "Consulta de orientação"; f.turn.origin = "text"; await f.execute();
    assert.equal(f.services.length, 1); assert.deepEqual(f.legacy, []); assert.equal(f.services[0].action.uiRevision, "visible");
  });
  await t.test("a mismatched original inbox lease cannot reach the typed dispatcher", async () => {
    const f = fixture(); f.choose(a => a.kind === "service_booking" && a.operation === "offer"); f.turn.leaseToken = "foreign-lease"; await f.execute();
    assert.deepEqual(f.services, []); assert.deepEqual(f.legacy, []);
  });
});
