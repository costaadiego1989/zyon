import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { addBusinessDays, businessDateKey } from "../src/shared/analytics/business-period.js";
import { professionalStorefrontSlot } from "../src/shared/bookings/service-checkout-cart.js";
import { createNativeServiceJourneyFixture, type NativeJourneyCase } from "./service-channel-journey.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Local evidence only: signed real Meta AUDIO envelopes + the existing scoped
// captured-transcript boundary. No Ogg download, STT accuracy, external model,
// Meta delivery, final resolver result or buyer authority is substituted here.
const speech = {
  "4201": "Quero marcar com a Dra. Beatriz amanhã ou depois de amanhã, às dez.",
  "4202": "Com a Dra. Camila amanhã, às dez ou às onze, ainda não decidi.",
  "4203": "Quero a Dra. Elisa amanhã, ainda preciso escolher o horário.",
  "4204": "Quero consultar com a Dra. Fernanda amanhã às dez.",
  "4205": "1",
  "4206": "1",
};
const offer = (suffix: string) => ({ productId: "t46-" + suffix + "-offer", variantId: "t46-" + suffix + "-offer-variant" });
const atStart = businessDateKey(new Date());
const dateOptions = [addBusinessDays(atStart, 1), addBusinessDays(atStart, 2)];
const select = (suffix: string, professionalName: string, extra: Record<string, unknown> = {}) => ({
  ...offer(suffix), professionalName, ...extra,
});
const modelTurn = (args: Record<string, unknown>) => [
  { phase: "storefront.intent", response: { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "COMPLEX_QUESTION", confidence: 1,
    requiresTool: true, needsProductDiscovery: false, shoppingPhase: null, serviceRequest: "live_facts", serviceAction: "select" } },
  { phase: "storefront.sales", serviceToolCall: { name: "resolve_service_selection", args } },
];
const script = [
  ...modelTurn(select("ambiguity-homonyms", "Dra. Ana Costa", { date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } })),
  ...modelTurn(select("ambiguity-day", "Dra. Beatriz", { date: { kind: "ambiguous", values: dateOptions }, time: { kind: "exact", value: "10:00" } })),
  ...modelTurn(select("ambiguity-time", "Dra. Camila", { date: { kind: "relative", value: "tomorrow" }, time: { kind: "ambiguous", values: ["10:00", "11:00"] } })),
  ...modelTurn(select("ambiguity-prior", "Dra. Daniela")),
  ...modelTurn(select("ambiguity-incomplete", "Dra. Elisa", { date: { kind: "relative", value: "tomorrow" } })),
  ...modelTurn(select("ambiguity-exact", "Dra. Fernanda", { date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } })),
  // The model may suggest foreign IDs. Real tenant-bound tools must refuse.
  ...modelTurn(select("ambiguity-foreign-target", "Profissional privado de outra empresa", { date: { kind: "relative", value: "tomorrow" }, time: { kind: "exact", value: "10:00" } })),
];

test("T42 signed native selection ambiguity", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createNativeServiceJourneyFixture({ serviceReleaseFixture: "matching", voiceTranscripts: speech, modelScript: script, storefrontRoutingProfile: "structured" });
  const view = (state: any) => state.view?.serviceBooking?.model;
  const actions = (state: any) => Object.values(state.selections ?? {}) as any[];
  const selection = (state: any) => {
    const model = view(state); assert.equal(model?.step, "review"); assert.equal(model.source.kind, "selection");
    return structuredClone(model.source.selection);
  };
  const publicModel = (state: any) => JSON.stringify({ body: state.view?.body, model: view(state), selections: state.selections });
  const modelEvents = () => f.runtime.storefrontQueryModel.events().filter((event: any) => event.kind === "providerFetch" && event.input.phase === "storefront.sales");
  const snapshot = async (c: NativeJourneyCase) => ({
    domain: await f.snapshot(c),
    checkouts: await f.prisma.checkoutSession.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" },
      select: { id: true, merchantId: true, sessionId: true, globalUserId: true, cart: true, customer: true, version: true } }),
    carts: await f.prisma.storefrontCart.findMany({ where: { merchantId: c.merchantId }, orderBy: { sessionId: "asc" },
      select: { merchantId: true, sessionId: true, items: true, total: true, discount: true, couponCode: true, freeShipping: true } }),
    stocks: await f.prisma.productStock.findMany({ where: { variantId: c.variantId }, orderBy: { id: "asc" } }),
    holds: (await f.redis.keys("service-slots:{" + createHash("sha256").update(c.merchantId).digest("hex") + "}:*")).sort(),
  });
  const noMoneyOrHolds = async (c: NativeJourneyCase) => {
    const current = await snapshot(c); assert.equal(current.domain.appointments.length, 0); assert.equal(current.domain.payments.length, 0);
    assert.equal(current.domain.audits.length, 0); assert.equal(current.domain.orders, 0); assert.equal(current.domain.inventory, 0);
    assert.deepEqual(current.holds, []); assert.equal(await f.prisma.appointmentPayment.count({ where: { merchantId: c.merchantId } }), 0);
  };
  const professional = async (c: NativeJourneyCase, name: string, onlyOneSlot = false) => {
    await f.prisma.serviceProfessional.update({ where: { id: c.professionalId }, data: { publicName: name } });
    if (onlyOneSlot) await f.prisma.professionalAvailability.updateMany({ where: { merchantId: c.merchantId, professionalId: c.professionalId }, data: { endMinute: 630 } });
  };
  const open = async (c: NativeJourneyCase) => {
    const turn = await f.message(c, "/servicos");
    // The ordinary shared storefront reader may create an empty cart. Make
    // that valid container an explicit precondition, then compare every
    // commercial field rather than mistaking allocation for a booking.
    await f.prisma.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: turn.state.conversationId } },
      create: { merchantId: c.merchantId, sessionId: turn.state.conversationId, expiresAt: new Date(Date.now() + 86_400_000) }, update: {} });
    return turn;
  };
  const futureReview = async (c: NativeJourneyCase) => {
    await open(c); await f.choose(c, "offer", action => action.productId === c.productId && action.variantId === c.variantId);
    await f.choose(c, "professional", action => action.professionalId === c.professionalId);
    const day = addBusinessDays(businessDateKey(new Date()), 2);
    await f.choose(c, "date", action => action.date === day);
    const current = await f.state(c), first = actions(current).find(action => f.operation(action, "slot"));
    assert.ok(first); await f.choose(c, "slot", action => action.selection.slotId === first.selection.slotId);
    return f.state(c);
  };
  // Seed only a commercial cart precondition from a REAL current native review.
  // This creates no checkout/lease/payment and does not supply a resolver result.
  const seedPriorCart = async (c: NativeJourneyCase, state: any) => {
    const chosen = selection(state), variant = await f.prisma.productVariant.findUniqueOrThrow({ where: { id: c.variantId }, include: { product: true } });
    const item = { productId: c.productId, variantId: c.variantId, sku: variant.sku, name: variant.product.name,
      quantity: 1, unitPriceCents: chosen.priceInCents, selectedServiceSlot: professionalStorefrontSlot(chosen) };
    await f.prisma.storefrontCart.upsert({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: state.conversationId } },
      create: { merchantId: c.merchantId, sessionId: state.conversationId, items: [item], total: chosen.priceInCents, expiresAt: new Date(Date.now() + 86_400_000) },
      update: { items: [item], total: chosen.priceInCents, discount: 0, couponCode: null, freeShipping: false } });
    return chosen;
  };
  const retained = (state: any, prior: unknown) => {
    const sources = [state.view, ...state.previousViews].map((value: any) => value?.serviceBooking?.model)
      .filter((value: any) => value?.step === "review" && value.source.kind === "selection");
    assert.ok(sources.some((value: any) => isDeepStrictEqual(value.source.selection, prior)), "prior canonical selection must survive clarification");
  };
  const explicitChoice = (state: any, step: string, operation: string, minimum = 1) => {
    assert.equal(view(state)?.step, step); assert.match(state.view.body, /escolh|selecione/i);
    assert.ok(actions(state).filter(action => f.operation(action, operation)).length >= minimum);
    assert.equal(actions(state).some(action => f.operation(action, "continue") || f.operation(action, "confirm")), false);
    assert.doesNotMatch(state.view.body, /agendamento (?:registrado|confirmado)|pagamento aprovado/i);
  };
  const say = async (c: NativeJourneyCase, text: string, mediaId?: keyof typeof speech) => {
    const before = modelEvents().length, turn = await f.message(c, mediaId ?? text, mediaId ? { audio: true } : {});
    const events = modelEvents().slice(before); assert.equal(events.length, 1, "exactly one real named model tool call must reach this native turn");
    assert.equal(events[0].result.serviceToolCall.name, "resolve_service_selection");
    assert.ok(events[0].input.toolNames.includes("resolve_service_selection"));
    assert.ok(JSON.stringify(events[0].input.messages).includes(text), "real normalized text/transcript must reach the shared agent");
    if (mediaId) {
      const payload = turn.inbox.payload as any;
      assert.equal(payload.metaMedia.id, mediaId); assert.equal(payload.metaMedia.mimeType, "audio/ogg");
      assert.equal(payload.authenticatedAccount.accountId, c.phoneNumberId); assert.notEqual(payload.body, text);
      const media = f.runtime.whatsapp.events().filter((event: any) => event.kind === "voiceInterpret" && event.input.media.id === mediaId);
      assert.equal(media.length, 1); assert.equal(media[0].result.kind, "audio_transcript"); assert.equal(media[0].result.text, text);
      assert.deepEqual(media[0].result.scope, { merchantId: c.merchantId, deviceId: c.deviceId, inboxId: turn.inbox.id,
        conversationId: turn.state.conversationId, mediaId });
      assert.equal(media[0].input.context.inboxId, turn.inbox.id);
    }
    return turn;
  };
  try {
    assert.equal(f.runtime.evidence().authOverrides, false); assert.equal(f.runtime.evidence().repositoryOverrides, false);
    assert.deepEqual(f.runtime.evidence().localModelOverrides, ["QueryKnowledgeUseCase.embeddingService", "storefront.STOREFRONT_PROVIDER_FETCH_FACTORY"]);
    await t.test("homonymous current professionals require a choice even when the second has no slot", async () => {
      const c = await f.make("ambiguity-homonyms", { hold: true }); await professional(c, "Dra. Ana Costa");
      const other = await f.prisma.serviceProfessional.create({ data: { merchantId: c.merchantId, publicName: "Dra. Ana Costa", timeZone: "America/Sao_Paulo", isActive: true, isPublished: true } });
      await f.prisma.professionalService.create({ data: { merchantId: c.merchantId, professionalId: other.id, productId: c.productId } });
      await open(c); const before = await snapshot(c);
      const turn = await say(c, "Quero a Dra. Ana Costa amanhã às dez."); explicitChoice(turn.state, "professionals", "professional", 2);
      assert.deepEqual(actions(turn.state).filter(action => f.operation(action, "professional")).map(action => action.professionalId).sort(), [c.professionalId, other.id].sort());
      assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
    });
    await t.test("a captured relative-day audio asks for an explicit real date without reserving", async () => {
      const c = await f.make("ambiguity-day", { hold: true }); await professional(c, "Dra. Beatriz"); await open(c);
      const before = await snapshot(c), turn = await say(c, speech["4201"], "4201"); explicitChoice(turn.state, "dates", "date", 2);
      const dates = actions(turn.state).filter(action => f.operation(action, "date")).map(action => action.date);
      assert.deepEqual([...new Set(dates)].sort(), dateOptions); assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
    });
    await t.test("ambiguous spoken time cannot be inferred from the only available slot", async () => {
      const c = await f.make("ambiguity-time", { hold: true }); await professional(c, "Dra. Camila", true); await open(c);
      const before = await snapshot(c), turn = await say(c, speech["4202"], "4202"); explicitChoice(turn.state, "slots", "slot");
      assert.equal(actions(turn.state).filter(action => f.operation(action, "slot")).length, 1);
      assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
    });
    await t.test("incomplete text preserves the existing commercial cart and exact prior reviewed selection", async () => {
      const c = await f.make("ambiguity-prior", { hold: true }); await professional(c, "Dra. Daniela");
      const previous = await futureReview(c), selected = await seedPriorCart(c, previous), before = await snapshot(c);
      const turn = await say(c, "Gostaria de consultar com a Dra. Daniela, mas ainda não escolhi a data."); explicitChoice(turn.state, "dates", "date");
      retained(turn.state, selected); assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
    });
    await t.test("a captured incomplete voice date still asks for time and creates no hidden reservation", async () => {
      const c = await f.make("ambiguity-incomplete", { hold: true }); await professional(c, "Dra. Elisa", true); await open(c);
      const before = await snapshot(c), turn = await say(c, speech["4203"], "4203"); explicitChoice(turn.state, "slots", "slot");
      assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
    });
    await t.test("exact captured voice proposes only review and cannot perform the separate prepare or confirm gestures", async () => {
      const c = await f.make("ambiguity-exact"); await professional(c, "Dra. Fernanda"); await open(c);
      const before = await snapshot(c), turn = await say(c, speech["4204"], "4204"); assert.equal(view(turn.state)?.step, "review");
      const chosen = selection(turn.state); assert.equal(chosen.professionalId, c.professionalId);
      assert.equal(chosen.date, addBusinessDays(businessDateKey(turn.inbox.createdAt), 1));
      assert.deepEqual(await snapshot(c), before); await noMoneyOrHolds(c);
      const afterChoice = await snapshot(c), calls = modelEvents().length;
      await f.message(c, "4205", { audio: true }); assert.equal(view(await f.state(c))?.step, "review");
      assert.deepEqual(await snapshot(c), afterChoice); assert.equal(modelEvents().length, calls);
      await f.choose(c, "continue"); assert.equal(view(await f.state(c))?.step, "prepared");
      const prepared = await snapshot(c); assert.equal(prepared.checkouts.length, 1); await noMoneyOrHolds(c);
      await f.message(c, "4206", { audio: true }); assert.equal(view(await f.state(c))?.step, "prepared");
      assert.deepEqual(await snapshot(c), prepared); assert.equal(modelEvents().length, calls); await noMoneyOrHolds(c);
    });
    await t.test("foreign model IDs and archived or foreign controls cannot borrow the current signed context", async () => {
      const c = await f.make("ambiguity-foreign-source", { hold: true }), other = await f.make("ambiguity-foreign-target", { hold: true });
      await professional(other, "Profissional privado de outra empresa"); await open(c); await open(other);
      const before = await snapshot(c), foreignBefore = await snapshot(other);
      const turn = await say(c, "Gostaria de escolher um horário para este atendimento.");
      assert.equal(publicModel(turn.state).includes("Profissional privado de outra empresa"), false);
      assert.equal(publicModel(turn.state).includes(other.productId), false); assert.equal(publicModel(turn.state).includes(other.professionalId), false);
      assert.deepEqual(await snapshot(c), before); assert.deepEqual(await snapshot(other), foreignBefore);
      await futureReview(c); const stale = await f.control(c, action => f.operation(action, "continue")); await f.message(c, "/servicos");
      const current = await snapshot(c), otherCurrent = await snapshot(other), calls = modelEvents().length;
      await f.message(c, "Continuar", { interactiveId: stale.id }); await f.message(other, "Continuar", { interactiveId: stale.id });
      assert.deepEqual(await snapshot(c), current); assert.deepEqual(await snapshot(other), otherCurrent); assert.equal(modelEvents().length, calls);
      await noMoneyOrHolds(c); await noMoneyOrHolds(other);
    });
    assert.equal(modelEvents().length, 7); assert.equal(f.runtime.storefrontQueryModel.counts().queryEmbeddings, 0);
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
