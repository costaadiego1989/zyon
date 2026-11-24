import assert from "node:assert/strict";
import test from "node:test";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { buildServiceBookingControls, presentServiceBookingControls, checkServiceControlFreshness, currentServiceControlDraft } from "./service-booking-controls.js";

const now = new Date("2030-01-01T12:00:00Z"), binding = { merchantId: "merchant", configId: "config", whatsappSessionId: "session",
  conversationId: "conversation", validUntil: now.getTime() + 60_000 };
const offer = { productId: "service", variantId: "variant", name: "Consulta de orientação" };
const professional = { id: "professional", name: "Dra. Joana", version: 3 };
function selection(index = 0, zone = "America/Sao_Paulo") {
  const startsAt = new Date(Date.parse("2030-01-02T13:00:00Z") + index * 30 * 60_000).toISOString();
  const tuple = { productId: offer.productId, variantId: offer.variantId, professionalId: professional.id, professionalVersion: 3, policyVersion: 2,
    date: "2030-01-02", startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(), timeZone: zone,
    durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
  return { ...tuple, slotId: professionalSlotId(binding.merchantId, tuple) };
}
const base = <T>(model: T) => ({ binding, model });
const slots = () => base({ step: "slots", offer, professional, date: "2030-01-02", policyVersion: 2,
  source: { kind: "slots", selections: Array.from({ length: 13 }, (_, i) => selection(i)), has_more: false } });
function published(raw: unknown = slots()) {
  const view = buildServiceBookingControls(raw, now), presentation = presentServiceBookingControls(view, "ui1", 0, { now });
  const state = { version: 1, stage: "store", conversationId: "conversation", revision: "ui1", page: presentation.page,
    history: [], previousViews: [], view, selections: presentation.selections, numericSelections: presentation.numericSelections } as any;
  const turn = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "session" }, conversationId: "conversation",
    inboxId: "current-inbox", leaseToken: "private-existing-lease", message: "Escolher", origin: "button" as const };
  return { view, presentation, state, turn };
}
test("T44", async t => {
  await t.test("service lists stay hierarchical and every native page fits ten rows", () => {
    const f = published(base({ step: "services", offers: Array.from({ length: 16 }, (_, i) => ({ ...offer, productId: "service-" + i, variantId: "variant-" + i })), hasMore: false }));
    for (let page = 0; page < 4; page++) { const p = presentServiceBookingControls(f.view, "revision-" + page, page, { now });
      assert.equal(p.totalPages, 4); assert.ok(p.numericSelections.length <= 10);
      assert.equal(p.numericSelections.filter(a => a.kind === "service_booking" && a.operation === "offer").length, page === 3 ? 1 : 5);
      assert.equal(p.numericSelections.some(a => a.kind === "tool"), false);
      assert.equal(p.numericSelections.filter(a => a.kind === "menu").length, 1);
      assert.equal(p.numericSelections.filter(a => a.kind === "message" && a.message === "Falar com atendente").length, 1);
    }
  });
  await t.test("an incomplete professional roster does not invent a cursor or assert total unavailability", () => {
    const view = buildServiceBookingControls(base({ step: "professionals", offer, source: { kind: "professionals", professionals: [], has_more: true } }), now);
    assert.match(view.body, /lista.*incompleta/i); assert.doesNotMatch(view.body, /nenhum profissional/i);
    assert.equal(view.choices.some(c => c.action.kind === "service_booking" && c.action.operation === "refine"), true);
    assert.equal(JSON.stringify(view).includes("cursor"), false);
  });
  await t.test("all thirty-one canonical dates are paginated without recalculating their labels", () => {
    const dates = Array.from({ length: 31 }, (_, i) => "2030-01-" + String(i + 1).padStart(2, "0"));
    const view = buildServiceBookingControls(base({ step: "dates", offer, professional, source: { kind: "dates", dates,
      professional_version: 3, policy_version: 2, time_zone: "America/Sao_Paulo" } }), now);
    const seen = new Set<string>(); for (let page = 0; page < 7; page++) {
      const p = presentServiceBookingControls(view, "date-" + page, page, { now }); assert.equal(p.totalPages, 7); assert.ok(p.numericSelections.length <= 10);
      for (const a of p.numericSelections) if (a.kind === "service_booking" && a.operation === "date") seen.add(a.date);
    } assert.deepEqual([...seen], dates);
  });
  await t.test("slots display canonical duration, price and zone and only propose review", () => {
    const f = published(); assert.match(f.view.body, /Brasília/);
    const action = f.presentation.numericSelections.find(a => a.kind === "service_booking" && a.operation === "slot") as any;
    assert.deepEqual(action.selection, selection(0)); assert.equal(action.uiRevision, "ui1");
    assert.match(f.view.choices[0]!.description!, /30 min/); assert.match(f.view.choices[0]!.description!, /50,00/);
    assert.equal(f.presentation.numericSelections.some(a => a.kind === "tool"), false);
  });
  await t.test("review uses current service/professional names and exact cents while keeping confirmation separate", () => {
    const view = buildServiceBookingControls(base({ step: "review", offer, source: { kind: "selection", selection: selection(), serviceName: "Nome atual",
      professionalName: "Profissional atual", policy: { version: 2, paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null },
      action: "review_service_booking", requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } }), now);
    assert.match(view.body, /Nome atual/); assert.match(view.body, /Profissional atual/); assert.match(view.body, /50,00/);
    assert.match(view.body, /no atendimento/i); assert.match(view.body, /ainda não.*confirmado/i);
    assert.equal(view.choices.filter(c => c.action.kind === "service_booking" && c.action.operation === "continue").length, 1);
    assert.equal(JSON.stringify(view).includes("parent_cart_fingerprint"), false);
  });
  await t.test("read failure and empty canonical availability have distinct truthful states", () => {
    const failed = buildServiceBookingControls(base({ step: "status", reason: "read_failed" }), now);
    const empty = buildServiceBookingControls(base({ step: "slots", offer, professional, date: "2030-01-02", policyVersion: 2,
      source: { kind: "slots", selections: [], has_more: false } }), now);
    assert.match(failed.body, /não consegui consultar/i); assert.doesNotMatch(failed.body, /sem horários/i);
    assert.match(empty.body, /não há horários.*data/i); assert.doesNotMatch(empty.body, /toda a agenda/i);
  });
  await t.test("source-version or selected-date drift produces no slot or continuation action", () => {
    for (const patch of [{ professional: { ...professional, version: 4 } }, { policyVersion: 3 }, { date: "2030-01-03" }]) {
      const raw = slots(), view = buildServiceBookingControls({ ...raw, model: { ...raw.model, ...patch } }, now);
      assert.equal(view.choices.some(c => c.action.kind === "service_booking"), false); assert.match(view.body, /atualizar/i);
    }
  });
  await t.test("a slot hashed for a foreign merchant is not accepted as a current native option", () => {
    const raw = slots(), value = selection(); value.slotId = professionalSlotId("foreign", value);
    const view = buildServiceBookingControls({ ...raw, model: { ...raw.model, source: { kind: "slots", selections: [value], has_more: false } } }, now);
    assert.equal(view.choices.some(c => c.action.kind === "service_booking"), false);
  });
  await t.test("expired presentation data never displays a bookable slot or silently extends its lifetime", () => {
    const raw = slots(), view = buildServiceBookingControls({ ...raw, binding: { ...binding, validUntil: now.getTime() } }, now);
    assert.match(view.body, /expirou/i); assert.equal(view.choices.some(c => c.action.kind === "service_booking"), false);
  });
  await t.test("the current native map returns a choice requiring canonical revalidation, never financial authority", () => {
    const f = published(), action = f.presentation.numericSelections[0]!;
    const checked = checkServiceControlFreshness({ action, state: f.state, turn: f.turn, now });
    assert.equal(checked.ok, true); if (!checked.ok) assert.fail("current choice expected");
    assert.equal(checked.requiresRevalidation, true); assert.equal(checked.authorizesConfirmation, false); assert.equal(checked.authorizesPayment, false);
  });
  await t.test("revision and current-map fences reject archived or fabricated actions", () => {
    const f = published(), action = f.presentation.numericSelections[0]! as any;
    for (const changed of [{ ...action, uiRevision: "archived" }, { ...action, selection: { ...action.selection, priceInCents: 1 } }, { ...action, confirmed: true }])
      assert.equal(checkServiceControlFreshness({ action: changed, state: f.state, turn: f.turn, now }).ok, false);
    assert.equal(checkServiceControlFreshness({ action, state: { ...f.state, selections: {} }, turn: f.turn, now }).ok, false);
  });
  await t.test("merchant, conversation, config, WhatsApp session and turn absence fail closed", () => {
    const f = published(), action = f.presentation.numericSelections[0]!;
    for (const key of ["merchantId", "configId", "whatsappSessionId"] as const)
      assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: { ...f.turn, scope: { ...f.turn.scope, [key]: "foreign" } }, now }).ok, false);
    assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: { ...f.turn, conversationId: "foreign" }, now }).ok, false);
    assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: undefined, now }).ok, false);
    assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: f.turn, now: new Date(binding.validUntil) }).ok, false);
  });
  await t.test("voice may propose a current slot but cannot continue toward preparation or confirmation", () => {
    const tuple = selection(), f = published(base({ step: "review", offer, source: { kind: "selection", selection: tuple, serviceName: offer.name,
      professionalName: professional.name, policy: { version: 2, paymentMode: "online", holdEnabled: true, holdMinutes: 4 },
      action: "review_service_booking", requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } }));
    const action = f.presentation.numericSelections[0]!;
    for (const origin of ["voice", "text"] as const) assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: { ...f.turn, origin }, now }).ok, false);
    assert.equal(checkServiceControlFreshness({ action, state: f.state, turn: f.turn, now }).ok, true);
    const listed = published(); assert.equal(checkServiceControlFreshness({ action: listed.presentation.numericSelections[0]!, state: listed.state, turn: { ...listed.turn, origin: "voice" }, now }).ok, true);
  });
  await t.test("long Unicode names remain visible in text and native fields retain their limits", () => {
    const name = "Orientação profissional sobre neurologia e acompanhamento 🧠 " + "completo ".repeat(15);
    const f = published(base({ step: "services", offers: [{ ...offer, name }], hasMore: false }));
    assert.equal(JSON.stringify(f.presentation.messages).includes(name), true);
    const rows = (f.presentation.messages.find(m => m.type === "interactive") as any).interactive.action.sections[0].rows;
    for (const row of rows) { assert.ok(Array.from(row.title).length <= 24); assert.ok(Array.from(row.description ?? "").length <= 72); }
  });
  await t.test("historical tuple zones and absolute instants remain unchanged", () => {
    const old = selection(0, "UTC"), view = buildServiceBookingControls(base({ step: "slots", offer, professional, date: old.date, policyVersion: 2,
      source: { kind: "slots", selections: [old], has_more: false } }), now);
    assert.match(view.choices[0]!.label, /13:00/); assert.match(view.body, /UTC/); assert.deepEqual((view.choices[0]!.action as any).selection, old);
  });
  await t.test("incomplete large lists reserve room for both page controls, refinement, back, menu and human", () => {
    const raw = slots(), view = buildServiceBookingControls({ ...raw, model: { ...raw.model, source: { ...raw.model.source, has_more: true } } }, now);
    const middle = presentServiceBookingControls(view, "middle", 1, { now }); assert.ok(middle.numericSelections.length <= 10);
    assert.equal(middle.numericSelections.filter(a => a.kind === "service_booking" && a.operation === "page").length, 2);
    assert.equal(middle.numericSelections.filter(a => a.kind === "service_booking" && a.operation === "refine").length, 1);
  });
  await t.test("negative source envelopes and past-started options cannot become current selections", () => {
    const raw = slots();
    for (const failure of [{ error: "private-source-error" }, { ok: false }, { success: false }]) {
      const view = buildServiceBookingControls({ ...raw, model: { ...raw.model, source: { ...raw.model.source, ...failure } } }, now);
      assert.equal(view.choices.some(c => c.action.kind === "service_booking"), false);
    }
    const afterStart = new Date("2030-01-02T13:00:00Z");
    const view = buildServiceBookingControls({ ...raw, binding: { ...binding, validUntil: afterStart.getTime() + 60_000 } }, afterStart);
    assert.equal(view.choices.some(c => c.action.kind === "service_booking"), false); assert.match(view.body, /atualizar/i);
  });
  await t.test("a uniquely displayed typed label binds only to the identical current persisted action", () => {
    const f = published(), draft = f.view.choices[0]!.action;
    assert.deepEqual(currentServiceControlDraft(draft, f.state), f.presentation.numericSelections[0]);
    assert.equal(currentServiceControlDraft(draft, { ...f.state, selections: {} }), undefined);
    assert.equal(currentServiceControlDraft({ ...draft, merchantId: "foreign" }, f.state), undefined);
  });
});
