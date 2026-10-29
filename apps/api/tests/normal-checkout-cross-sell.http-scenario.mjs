import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

// Runs only inside the existing owned AppModule journey. No server, credential,
// alternate auth, fixture acceptance, provider, or retry is created here.
export async function exerciseNormalCheckoutCrossSellHttp({ owned, request, merchantId, sessionId, cartId, headers, unprivilegedHeaders,
  catalog = owned.seed, scheduled = false }) {
  const scope = { merchantId, sessionId };
  const checkout = () => owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } });
  const source = () => owned.prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
  const fingerprint = async () => createHash("sha256").update(JSON.stringify([await checkout(), await source(),
    await owned.prisma.crossSellSuggestion.findMany({ where: scope, orderBy: { id: "asc" } }),
    await owned.prisma.checkoutEvent.findMany({ where: scope, orderBy: { id: "asc" } }),
    await owned.prisma.outboxMessage.findMany({ where: { merchantId, OR: [
      { payload: { path: ["session_id"], equals: sessionId } }, { payload: { path: ["ack", "sessionId"], equals: sessionId } },
    ] }, orderBy: { eventId: "asc" }, select: { eventId: true, merchantId: true, eventType: true, schemaVersion: true,
      producer: true, payload: true, occurredAt: true, correlationId: true, causationId: true } }),
    await owned.prisma.paymentIntent.findMany({ where: scope }), await owned.prisma.completedOrder.findMany({ where: scope })])).digest("hex");
  const before = await checkout();
  const suggestions = (await request("/v1/embed/cross-sell/suggest", { method: "POST", headers,
    body: { session_id: sessionId, cart: before.cart }, status: 201 })).data;
  assert.ok(Array.isArray(suggestions));
  const suggestion = suggestions.find(value => value.promo_id === catalog.promotionId);
  assert.ok(suggestion?.id && suggestion.ranked_items.includes(catalog.target.sku), "normal_http_actual_suggestion_required");
  const selection = { session_id: sessionId, suggestion_id: suggestion.id, targets: [{ sku: catalog.target.sku,
    variant_id: catalog.target.variantId, quantity: 1, selected_option_item_ids: ["large"] }] };
  const acceptanceEventId = `normal_cross_sell_${createHash("sha256").update(JSON.stringify([merchantId, sessionId, suggestion.id])).digest("hex")}`;
  const acceptanceRows = () => owned.prisma.outboxMessage.findMany({ where: { merchantId, eventId: acceptanceEventId },
    select: { eventId: true, eventType: true, merchantId: true, causationId: true, payload: true } });
  const original = await fingerprint();
  assert.deepEqual(await acceptanceRows(), []);
  await request("/v1/embed/cross-sell/quote", { method: "POST", headers: unprivilegedHeaders,
    body: selection, status: 403 });
  await request("/v1/embed/cross-sell/quote", { method: "POST", headers,
    body: { ...selection, session_id: randomUUID() }, status: 401 });
  await request("/v1/embed/cross-sell/quote", { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:9" },
    body: selection, status: 403 });
  await request("/v1/embed/cross-sell/quote", { method: "POST", headers: { ...headers, origin: "" },
    body: selection, status: 403 });
  if (scheduled) {
    const refused = (await request("/v1/embed/cross-sell/quote", { method: "POST", headers, body: selection, status: 409 })).data;
    assert.equal(refused.code, "cross_sell_quote_review_required");
    assert.equal(refused.detail, "cross_sell_quote_review_required");
    assert.equal(refused.type, "https://docs.aacp.dev/problems/cross_sell_quote_review_required");
    assert.equal(await fingerprint(), original, "normal_http_scheduled_refusal_changed_commerce");
    assert.deepEqual(await acceptanceRows(), []);
    assert.equal((await owned.prisma.crossSellSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status, "pending");
    assert.equal(await owned.prisma.paymentIntent.count({ where: scope }), 0);
    assert.equal(await owned.prisma.completedOrder.count({ where: scope }), 0);
    return { scheduledServiceBlocked: true, refusedWritesUnchanged: true, durableAcceptanceAbsent: true, merchandiseCents: 5000 };
  }
  await request("/v1/embed/cross-sell/quote", { method: "POST", headers,
    body: { ...selection, targets: [{ ...selection.targets[0], selected_option_item_ids: [] }] }, status: 409 });
  assert.equal(await fingerprint(), original, "normal_http_refused_or_read_only_quote_mutated_state");
  const quote = (await request("/v1/embed/cross-sell/quote", { method: "POST", headers, body: selection, status: 201 })).data;
  assert.equal(quote.merchantId, merchantId); assert.equal(quote.sessionId, sessionId);
  assert.equal(quote.suggestionId, suggestion.id); assert.equal(quote.sessionVersion, before.version);
  assert.equal(quote.pricing.originalSubtotalCents, 10500);
  assert.equal(quote.pricing.merchandiseSubtotalCents, 9950);
  assert.equal(quote.pricing.promotionDiscountCents, 550); assert.equal(quote.pricing.cartDiscountCents, 0);
  assert.equal(quote.pricing.targets.length, 1);
  assert.equal(quote.pricing.targets[0].originalUnitPriceCents, 5500);
  assert.equal(quote.pricing.targets[0].maximumUnitPriceCents, 4950);
  assert.deepEqual(quote.pricing.targets[0].selectedOptionItemIds, ["large"]);
  assert.equal(await fingerprint(), original, "normal_http_quote_must_be_read_only");
  const acceptance = { session_id: sessionId, suggestion_id: suggestion.id,
    accepted_skus: [catalog.target.sku], expected_quote: quote };
  const changed = structuredClone(acceptance); changed.expected_quote.contextHash = "0".repeat(64);
  await request("/v1/embed/cross-sell/accept", { method: "POST", headers, body: changed, status: 409 });
  assert.equal(await fingerprint(), original, "normal_http_stale_accept_wrote_state");
  const accepted = (await request("/v1/embed/cross-sell/accept", { method: "POST", headers, body: acceptance, status: 201 })).data;
  assert.equal(accepted.projection_status, "available");
  assert.deepEqual(accepted.acknowledgement, { version: 1, status: "accepted", ...scope, suggestionId: suggestion.id,
    persistenceVersion: before.version + 1, quoteHash: createHash("sha256").update(JSON.stringify(quote)).digest("hex") });
  assert.equal(accepted.cart.total, 99.5); assert.equal(accepted.experience.totals.subtotal, 99.5);
  const after = await checkout(), actualSource = await source();
  assert.equal(after.cart.items.length, 2); assert.equal(after.cart.total, 99.5);
  const target = after.cart.items.find(item => item.variantId === catalog.target.variantId);
  assert.ok(target?.crossSellIntent); assert.equal(target.price, 49.5); assert.equal(target.originalPrice, 55);
  assert.equal(target.quantity, 1); assert.equal(target.selected_options[0].price_modifier, 5);
  assert.equal(actualSource.total, 10500); assert.equal(actualSource.discount, 0);
  assert.equal(actualSource.items.find(item => item.variantId === target.variantId)?.unitPriceCents, 5500);
  const expectedTypes = [catalog.trigger.productType ?? "physical", catalog.target.productType ?? "physical"];
  for (const [index, product] of [catalog.trigger, catalog.target].entries()) {
    const persistedLine = after.cart.items.find(item => item.variantId === product.variantId);
    const publicLine = accepted.cart.items.find(item => item.variantId === product.variantId);
    const experienceLine = accepted.experience.items.find(item => item.id === product.variantId || item.variantId === product.variantId || item.sku === product.sku);
    const strategy = expectedTypes[index] === "digital" ? "digital" : expectedTypes[index] === "service" ? "service" : "carrier";
    assert.equal(persistedLine?.productType, expectedTypes[index]); assert.equal(persistedLine?.fulfillmentStrategy, strategy);
    assert.equal(publicLine?.productType, expectedTypes[index]); assert.equal(publicLine?.fulfillmentStrategy, strategy);
    // Experience's legacy item wire does not carry type/strategy. The SDK binds
    // those to this SAME validated public cart by SKU/identity and cents.
    assert.equal(experienceLine?.sku, product.sku); assert.equal(experienceLine?.unit_price, publicLine.price);
    assert.equal(experienceLine?.quantity, publicLine.quantity);
  }
  const physical = expectedTypes.some(type => type !== "digital" && type !== "service");
  assert.equal(accepted.experience.stage, physical ? "shipping" : "payment");
  if (!physical) { assert.equal(after.shipping, null); assert.equal(accepted.experience.totals.shipping, 0); }
  const acceptedRows = await acceptanceRows();
  assert.equal(acceptedRows.length, 1);
  assert.equal(acceptedRows[0].eventType, "cross-sell.offer.accepted");
  assert.equal(acceptedRows[0].causationId, suggestion.id);
  assert.equal(acceptedRows[0].payload.protocol, "normal_checkout_cross_sell_v1");
  assert.deepEqual(acceptedRows[0].payload.quote, quote);
  assert.deepEqual(acceptedRows[0].payload.ack, accepted.acknowledgement);
  const committed = await fingerprint();
  const replay = (await request("/v1/embed/cross-sell/accept", { method: "POST", headers, body: acceptance, status: 201 })).data;
  assert.deepEqual(replay.acknowledgement, accepted.acknowledgement);
  assert.equal(await fingerprint(), committed, "normal_http_repeated_accept_must_not_replay_write");
  assert.deepEqual(await acceptanceRows(), acceptedRows, "normal_http_repeated_accept_must_not_duplicate_outbox");
  return { advertisedDiscountApplied: true, explicitOptions: true, durableAcknowledgement: true,
    refusedWritesUnchanged: true, repeatAcceptNoWrite: true, merchandiseCents: 9950, productTypes: expectedTypes,
    canonicalStage: accepted.experience.stage };
}
