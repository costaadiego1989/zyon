import assert from "node:assert/strict";
import test from "node:test";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { resolveServiceSelection, type CurrentServiceSelectionOption, type ServiceSelectionInterpretation } from "./service-selection.js";

const now = new Date("2030-01-01T02:30:00Z"); // Still December31 in Brasilia.
function option(patch: Partial<CurrentServiceSelectionOption> = {}): CurrentServiceSelectionOption {
  const value = { merchantId: "merchant", productId: "service", variantId: "variant", productName: "Consultation",
    professionalId: "professional", professionalName: "Dra. Joana", professionalVersion: 3, policyVersion: 2,
    date: "2030-01-01", startsAt: "2030-01-01T13:00:00.000Z", endsAt: "2030-01-01T13:30:00.000Z", timeZone: "UTC",
    durationMinutes: 30, priceInCents: 5000, currency: "BRL", ...patch };
  return { ...value, slotId: professionalSlotId(value.merchantId, value) };
}
const selection = (): ServiceSelectionInterpretation => ({ kind: "selection", professionalName: "Dra. Joana",
  date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } });
function snapshot(options: CurrentServiceSelectionOption[], clock = now, complete = true, rosterComplete = true) {
  return { merchantId: "merchant", asOf: clock.toISOString(), complete, options,
    professionalRoster: { complete: rosterComplete, professionals: [...new Map(options.map(value => [JSON.stringify([value.productId, value.variantId, value.professionalId]), {
      merchantId: value.merchantId, productId: value.productId, variantId: value.variantId, professionalId: value.professionalId,
      professionalName: value.professionalName, professionalVersion: value.professionalVersion }])).values()] } };
}
function resolve(interpretation: unknown = selection(), options = [option()], extra: Record<string, unknown> = {}) {
  return resolveServiceSelection({ merchantId: "merchant", channel: "text", now, interpretation,
    current: snapshot(options), ...extra } as never);
}
function assertSafe(value: ReturnType<typeof resolve>) {
  assert.equal(value.requiresRevalidation, true); assert.equal(value.authorizesPayment, false); assert.equal(value.authorizesConfirmation, false);
}

test("T42", async t => {
  await t.test("complete typed current candidates resolve a proposal with exact server facts and no business authority", () => {
    const value = resolve(); assertSafe(value); assert.equal(value.kind, "resolved");
    if (value.kind !== "resolved") assert.fail("current exact selection required");
    assert.deepEqual(value.selection, option()); assert.equal(value.displayDate, "2030-01-01"); assert.equal(value.displayTime, "10:00");
    assert.equal(value.displayTimeZone, "America/Sao_Paulo"); assert.equal(value.sourceAsOf, now.toISOString());
  });
  await t.test("tomorrow follows injected Brasilia midnight and year rollover rather than UTC or option zone", () => {
    const value = resolve(); assert.equal(value.kind, "resolved");
    if (value.kind !== "resolved") assert.fail("expected Brasilia tomorrow");
    assert.equal(value.selection.timeZone, "UTC"); assert.equal(value.selection.startsAt, "2030-01-01T13:00:00.000Z");
    assert.equal(value.displayDate, "2030-01-01");
    const dayAfter = resolve({ ...selection(), date: { kind: "relative", value: "day_after_tomorrow" } }, [option({ date: "2030-01-02",
      startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z" })]);
    assert.equal(dayAfter.kind, "resolved");
  });
  await t.test("historic DST date uses existing business calendar while preserving the canonical stored zone", () => {
    const instant = new Date("2018-11-04T02:30:00Z"), stored = option({ date: "2018-11-04", startsAt: "2018-11-04T12:00:00.000Z", endsAt: "2018-11-04T12:30:00.000Z" });
    const value = resolve(selection(), [stored], { now: instant, current: snapshot([stored], instant) });
    assert.equal(value.kind, "resolved"); if (value.kind !== "resolved") assert.fail("DST tomorrow must resolve");
    assert.equal(value.displayTime, "10:00"); assert.equal(value.selection.timeZone, "UTC"); assert.equal(value.selection.startsAt, stored.startsAt);
  });
  await t.test("homonymous professional labels require explicit current choice even if one time fits", () => {
    const duplicate = option({ professionalId: "other-professional", startsAt: "2030-01-01T14:00:00.000Z", endsAt: "2030-01-01T14:30:00.000Z" });
    const value = resolve(selection(), [option(), duplicate]); assertSafe(value); assert.equal(value.kind, "clarification");
    if (value.kind !== "clarification") assert.fail("homonyms must not be guessed");
    assert.equal(value.reason, "choose_professional"); assert.deepEqual(new Set(value.options.map(item => item.professionalId)), new Set(["professional", "other-professional"]));
  });
  await t.test("normalization only matches a complete current label and never a substring or fuzzy inferred professional", () => {
    const exact = resolve({ ...selection(), professionalName: "  DRA. JÓANA  " }); assert.equal(exact.kind, "resolved");
    const partial = resolve({ ...selection(), professionalName: "Joana" }); assert.equal(partial.kind, "clarification");
    if (partial.kind !== "clarification") assert.fail("partial name must not be authority"); assert.equal(partial.reason, "no_current_match");
  });
  await t.test("an explicit active option ID is rebound to the current canonical tuple", () => {
    const a = option(), b = option({ professionalId: "other" });
    const value = resolve({ kind: "selection" }, [a, b], { explicitSlotId: b.slotId });
    assert.equal(value.kind, "resolved"); if (value.kind !== "resolved") assert.fail("explicit option expected"); assert.deepEqual(value.selection, b); assertSafe(value);
  });
  await t.test("foreign, forged and expired option IDs do not restore an old choice", () => {
    const previous = option();
    for (const explicitSlotId of ["forged", option({ merchantId: "foreign" }).slotId]) {
      const value = resolve({ kind: "selection" }, [option()], { explicitSlotId, previous });
      assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("unknown ID must clarify");
      assert.equal(value.reason, "no_current_match"); assert.deepEqual(value.previous, previous);
    }
    const old = option({ date: "2029-12-30", startsAt: "2029-12-30T13:00:00.000Z", endsAt: "2029-12-30T13:30:00.000Z" });
    assert.equal(resolve({ kind: "selection" }, [old], { explicitSlotId: old.slotId }).kind, "clarification");
  });
  await t.test("ambiguous voice dates ask for a current date without reserving or changing previous state", () => {
    const previous = option(), next = option({ date: "2030-01-08", startsAt: "2030-01-08T13:00:00.000Z", endsAt: "2030-01-08T13:30:00.000Z" });
    const value = resolve({ ...selection(), date: { kind: "ambiguous", values: ["2030-01-01", "2030-01-08"] } }, [previous, next], { channel: "voice", previous });
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("ambiguous date must clarify");
    assert.equal(value.reason, "choose_date"); assert.deepEqual(value.previous, previous); assert.equal(value.options.length, 2); assertSafe(value);
  });
  await t.test("ambiguous spoken clock times ask explicitly even when only one alternative is available", () => {
    const value = resolve({ ...selection(), time: { kind: "ambiguous", values: ["02:00", "14:00"] } }, [option({ startsAt: "2030-01-01T17:00:00.000Z", endsAt: "2030-01-01T17:30:00.000Z" })], { channel: "voice" });
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("spoken ambiguity must remain explicit");
    assert.equal(value.reason, "choose_time"); assertSafe(value);
  });
  await t.test("exact voice transcription may propose current facts but cannot confirm or authorize any payment", () => {
    const value = resolve(selection(), [option()], { channel: "voice" }); assert.equal(value.kind, "resolved"); assertSafe(value);
    for (const interpretation of [{ ...selection(), pay: true }, { ...selection(), confirm: true }, { kind: "pay" }, { kind: "confirm" }])
      assert.throws(() => resolve(interpretation), /service_selection_interpretation_invalid/);
  });
  await t.test("model hints cannot carry canonical IDs, prices, tenant identities, clocks or available flags", () => {
    for (const extra of [{ professionalId: "professional" }, { slotId: option().slotId }, { priceInCents: 1 }, { currency: "BRL" },
      { merchantId: "merchant" }, { available: true }, { now: "2030-01-01" }])
      assert.throws(() => resolve({ ...selection(), ...extra }), /service_selection_interpretation_invalid/);
  });
  await t.test("a partial page cannot establish uniqueness for either name or explicit current ID", () => {
    for (const explicitSlotId of [undefined, option().slotId]) {
      const value = resolve(selection(), [option()], { explicitSlotId, current: snapshot([option()], now, false) });
      assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("partial page must not resolve");
      assert.equal(value.reason, "more_current_options"); assert.equal(value.hasMore, true); assertSafe(value);
    }
  });
  await t.test("side questions retain prior state even when a current option source is unavailable", () => {
    const previous = option(), before = structuredClone(previous);
    const value = resolve({ kind: "side_question" }, [], { previous, current: null, channel: "voice" });
    assert.equal(value.kind, "unchanged"); if (value.kind !== "unchanged") assert.fail("side question must preserve state");
    assert.deepEqual(value.selection, before); assert.deepEqual(previous, before); assertSafe(value);
  });
  await t.test("an unclear turn cannot become an implicit exact-choice retry", () => {
    const previous = option(), value = resolve({ kind: "unclear" }, [previous], { previous });
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("unclear must clarify");
    assert.deepEqual(value.previous, previous); assertSafe(value);
  });
  await t.test("an empty selection hint asks for an explicit current choice instead of replaying prior state", () => {
    const value = resolve({ kind: "selection" }, [option()], { previous: option() });
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("no silent replay");
    assert.equal(value.reason, "choose_current_option");
  });
  await t.test("a changed time retains the selected professional and date but rebinds current price and versions", () => {
    const previous = option(), current = option({ startsAt: "2030-01-01T14:00:00.000Z", endsAt: "2030-01-01T14:30:00.000Z", priceInCents: 5500, policyVersion: 3 });
    const value = resolve({ kind: "selection", time: { kind: "exact", value: "11:00" } }, [current], { previous });
    assert.equal(value.kind, "resolved"); if (value.kind !== "resolved") assert.fail("contextual time choice expected");
    assert.equal(value.selection.professionalId, previous.professionalId); assert.equal(value.selection.priceInCents, 5500);
    assert.equal(value.selection.policyVersion, 3); assertSafe(value); assert.equal(previous.priceInCents, 5000);
  });
  await t.test("missing day or time without a prior selection requests the missing current dimension", () => {
    const noDate = resolve({ kind: "selection", professionalName: "Dra. Joana", time: { kind: "exact", value: "10:00" } });
    assert.equal(noDate.kind, "clarification"); if (noDate.kind !== "clarification") assert.fail("date choice required"); assert.equal(noDate.reason, "choose_date");
    const noTime = resolve({ kind: "selection", professionalName: "Dra. Joana", date: { kind: "relative", value: "tomorrow" } });
    assert.equal(noTime.kind, "clarification"); if (noTime.kind !== "clarification") assert.fail("time choice required"); assert.equal(noTime.reason, "choose_time");
  });
  await t.test("same display date and time with distinct slots still needs an explicit option", () => {
    const value = resolve(selection(), [option(), option({ variantId: "another-variant" })]);
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("distinct variants must clarify");
    assert.equal(value.reason, "choose_current_option"); assert.equal(value.options.length, 2);
  });
  await t.test("canonical slot forgery or conflicting same-ID commercial facts never leaves a falsely unique candidate", () => {
    const original = option(), conflict = { ...original, priceInCents: 6000 };
    for (const options of [[{ ...original, slotId: "forged" }], [original, conflict]]) {
      const value = resolve(selection(), options); assert.equal(value.kind, "clarification");
      if (value.kind !== "clarification") assert.fail("invalid source facts must refresh"); assert.equal(value.reason, "refresh_current_options"); assert.equal(value.options.length, 0);
    }
  });
  await t.test("foreign snapshot or previous state is rejected without leaking an option", () => {
    assert.throws(() => resolve(selection(), [option({ merchantId: "foreign" })]), /service_selection_source_scope_invalid/);
    assert.throws(() => resolve({ kind: "side_question" }, [], { previous: option({ merchantId: "foreign" }) }), /service_selection_state_scope_invalid/);
  });
  await t.test("bounded current choices remain explicit about further options and preserve all inputs", () => {
    const options = Array.from({ length: 21 }, (_, index) => option({ professionalId: "p" + index })), before = structuredClone(options);
    const value = resolve({ kind: "selection" }, options); assert.equal(value.kind, "clarification");
    if (value.kind !== "clarification") assert.fail("choices expected"); assert.equal(value.options.length, 20); assert.equal(value.hasMore, true);
    assert.deepEqual(options, before); value.options[0]!.professionalName = "changed"; assert.deepEqual(options, before);
  });
  await t.test("output projection excludes unexpected private source and prior-state metadata", () => {
    const unsafe = { ...option(), privateLease: "private-generation", providerEvidence: { token: "private-token" } };
    assert.equal(JSON.stringify(resolve(selection(), [unsafe])).includes("private-"), false);
    assert.equal(JSON.stringify(resolve({ kind: "side_question" }, [], { previous: unsafe })).includes("private-"), false);
  });
  await t.test("invalid civil dates, clocks and bounded interpretation fields fail before a proposal", () => {
    for (const interpretation of [{ ...selection(), date: { kind: "absolute", value: "2030-02-30" } },
      { ...selection(), time: { kind: "exact", value: "25:00" } }, { ...selection(), date: { kind: "relative", value: "someday" } },
      { ...selection(), professionalName: " " }, { ...selection(), time: { kind: "exact", value: "10:00", pay: true } }])
      assert.throws(() => resolve(interpretation), /service_selection_interpretation_invalid/);
    assert.throws(() => resolve(selection(), [option()], { now: new Date(NaN) }), /service_selection_input_invalid/);
    assert.throws(() => resolve(selection(), [option()], { channel: "unknown" }), /service_selection_input_invalid/);
  });
  await t.test("a complete professional roster includes homonyms without slots so availability never selects the person", () => {
    const current = snapshot([option()]);
    current.professionalRoster.professionals.push({ merchantId: "merchant", productId: "service", variantId: "variant", professionalId: "without-slots",
      professionalName: "Dra. Joana", professionalVersion: 4 });
    const value = resolve(selection(), [option()], { current }); assert.equal(value.kind, "clarification");
    if (value.kind !== "clarification") assert.fail("no-slot homonym still requires explicit choice");
    assert.equal(value.reason, "choose_professional"); assert.deepEqual(new Set(value.professionals.map(person => person.professionalId)), new Set(["professional", "without-slots"]));
    assert.equal(value.options.length, 1); assertSafe(value);
  });
  await t.test("an incomplete professional roster cannot prove uniqueness even with complete matching slots", () => {
    const value = resolve(selection(), [option()], { current: snapshot([option()], now, true, false) });
    assert.equal(value.kind, "clarification"); if (value.kind !== "clarification") assert.fail("partial professional roster must not guess");
    assert.equal(value.reason, "more_current_professionals"); assert.equal(value.hasMore, true); assertSafe(value);
  });
  await t.test("slots absent from the roster or with conflicting professional versions request a fresh canonical source", () => {
    for (const mutation of ["missing", "version"]) {
      const current = snapshot([option()]);
      if (mutation === "missing") current.professionalRoster.professionals = []; else current.professionalRoster.professionals[0]!.professionalVersion++;
      const value = resolve(selection(), [option()], { current }); assert.equal(value.kind, "clarification");
      if (value.kind !== "clarification") assert.fail("conflicting current source must refresh"); assert.equal(value.reason, "refresh_current_options");
    }
  });
});
