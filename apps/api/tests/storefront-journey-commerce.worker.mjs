import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createOwnedStorefrontJourneyApp } from "./storefront-journey-owned-app.mjs";
import { seedInitialCommerceCart, configureOwnedCommerceDelivery } from "./storefront-journey-commerce.seed.mjs";
import { exerciseNormalCheckoutCrossSellHttp } from "./normal-checkout-cross-sell.http-scenario.mjs";
import { exerciseNeighborhoodOriginHttp } from "./storefront-journey-neighborhood.http-scenario.mjs";
import { journeyErrorSource, journeyMutationBuckets } from "./storefront-journey-error-source.mjs";

const [databaseUrl, databaseRunId, redisUrl, redisRunId, tree, runId, merchantId, buyerId, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0); assert.equal(tree, "dist-test");
const secrets = [];
const phase = (stage, data = {}) => console.log("JOURNEY_COMMERCE_STAGE " + JSON.stringify({ stage, ...data }));
const compiled = relative => import(new URL(`../${tree}/${relative}.js`, import.meta.url));
let owned, evidence, failure, stageName = "owned_app_creation", requests = 0;
const cleanupErrorCodes = new Set(["commerce_owned_app_cleanup_failed", "journey_owned_app_cleanup_failed",
  "journey_owned_app_setup_and_cleanup_failed", "journey_owned_app_close_timeout", "journey_owned_prisma_close_timeout",
  "journey_owned_verifier_redis_close_timeout", "journey_verifier_cleanup_failed", "journey_verifier_sql_cleanup_timeout",
  "journey_verifier_redis_cleanup_timeout", "journey_owned_redis_cleanup_failed", "journey_owned_redis_disconnect_close_timeout",
  "journey_owned_redis_disconnect_failed", "journey_owned_redis_capture_failed", "journey_owned_redis_capture_not_live",
  "journey_owned_redis_socket_changed_during_capture", "journey_owned_redis_warm_failed", "journey_owned_redis_ping_timeout",
  "journey_owned_lazy_redis_connect_timeout", "journey_owned_redis_ended_without_open_socket_required",
  "journey_ready_redis_socket_proof_required", "journey_queue_readiness_timeout", "journey_worker_client_timeout",
  "journey_worker_readiness_timeout", "construction_owned_redis_ended_before_ready", "construction_owned_redis_ready_timeout",
  "construction_owned_redis_close_timeout", "construction_redis_socket_identity_required", "construction_redis_socket_ownership_required",
  "construction_native_tcp_unique_tuple_required", "journey_uncontrolled_or_cleanup_provider_attempt",
  "journey_commerce_must_not_attempt_provider", "journey_early_fence_cleanup_conflict", "journey_early_fence_restore_identity_required",
  "journey_approved_egress_violation", "commerce_external_provider_attempt_forbidden"]);
const redisOwners = new Set(["Queue.client", "Worker.client", "Worker.blockingClient", "Redis", "RedisRateLimitStore.redis",
  "RateLimitStore.redis", "RedisOtpStore.redis", "RedisEmailChangeOtpStore.redis", "RedisServiceSlots.redis"]);
const redisStates = new Set(["wait", "reconnecting", "connecting", "connect", "ready", "close", "end"]);
const dataValue = (value, key) => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
function safeRedisDiagnostic(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = {};
  if (Object.hasOwn(value, "owner")) output.owner = redisOwners.has(value.owner) ? value.owner : "unlisted_owner";
  if (Object.hasOwn(value, "status")) output.status = redisStates.has(value.status) ? value.status : "unlisted_status";
  for (const key of ["isSocket", "socketClosed", "socketDestroyed", "socketConnecting", "socketGenerationChanged"])
    if (typeof value[key] === "boolean" || value[key] === null) output[key] = value[key];
  for (const key of ["commandQueueLength", "totalClients", "queues", "workers", "changedCount"])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1_000_000) output[key] = value[key];
  if (["none", "quit", "other"].includes(value.queueHead)) output.queueHead = value.queueHead;
  if (["close_timeout", "ownership_or_close_failed"].includes(value.cause)) output.cause = value.cause;
  if (Array.isArray(value.clients)) output.clients = value.clients.slice(0, 5).map(safeRedisDiagnostic).filter(Boolean);
  return output;
}
function safeError(error, depth = 0, budget = { remaining: 24 }, seen = new WeakSet()) {
  if (depth > 4 || budget.remaining-- <= 0 || !error || typeof error !== "object" || seen.has(error)) return { code: "diagnostic_truncated" };
  seen.add(error);
  const rawMessage = dataValue(error, "message"), message = typeof rawMessage === "string" ? rawMessage : "";
  const candidate = message.split(":", 1)[0].split("\n", 1)[0];
  const neighborhoodRefusal = ["foreign_session", "missing_city", "foreign_city", "foreign_state", "origin_zip_quote",
    "origin_zip_select", "origin_city_quote", "unavailable_candidate"].some(label => candidate === `neighborhood_http_${label}_refusal_wrote_state`);
  const code = cleanupErrorCodes.has(candidate) || neighborhoodRefusal ? candidate : "unlisted_error";
  const nativeCode = dataValue(error, "code");
  const output = { name: error instanceof AggregateError ? "AggregateError" : nativeCode === "ERR_ASSERTION" ? "AssertionError" : "Error", code };
  const source = journeyErrorSource(error); if (source) output.source = source;
  const changedTables = journeyMutationBuckets(error); if (changedTables) output.changedTables = changedTables;
  if (["ERR_ASSERTION", "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "NR_CLOSED"].includes(nativeCode)) output.nativeCode = nativeCode;
  // Tracker's JSON contains fixed technical fields. Parse/reproject only those;
  // aggregate concatenations, arbitrary messages/config/URLs/tokens never print.
  if (code !== "unlisted_error" && message.startsWith(`${candidate}:{`) && message.length <= 16_000) {
    try { const diagnostic = safeRedisDiagnostic(JSON.parse(message.slice(candidate.length + 1))); if (diagnostic) output.diagnostic = diagnostic; } catch { /* code remains visible, raw message remains private */ }
  }
  const nested = dataValue(error, "errors");
  if (Array.isArray(nested)) {
    output.errorCount = nested.length;
    output.errors = nested.slice(0, 5).map(child => safeError(child, depth + 1, budget, seen));
  }
  const cause = dataValue(error, "cause");
  if (cause) output.cause = safeError(cause, depth + 1, budget, seen);
  return output;
}
const cents = value => { assert.equal(typeof value, "number"); assert.ok(Number.isFinite(value)); return Math.round(value * 100); };
const forbidden = new Set(["_widgetCrossSellAcceptance", "_storefrontCouponBinding", "widgetCheckoutAuthority", "normalCrossSellAuthority",
  "discountOwner", "crossSellIntent", "otp_code", "otp_expires_at", "otp_delivery_id", "otp_delivery_email",
  "downloadUrl", "download_url", "digitalContent", "digital_content"]);
// Fixed public machine codes only. Never print body/detail/error/provider text,
// financial snapshots, credentials or a caller-controlled code on a failure.
const safeRefusalCodes = new Set(["cross_sell_quote_review_required", "checkout_price_review_required",
  "storefront_cart_binding_conflict", "storefront_cart_checkout_bound", "conversation_access_denied",
  "payment_provider_not_configured", "checkout_discount_policy_unavailable", "discount_price_review_required",
  "checkout_review_required", "CHECKOUT_SESSION_VERSION_CONFLICT", "checkout_session_version_conflict",
  "CHECKOUT_PAYMENT_REQUIRES_REOPEN", "CHECKOUT_COMMERCIAL_SESSION_CLOSED",
  "recovery_buyer_login_required", "recovery_buyer_mismatch", "recovery_origin_not_allowed"]);
function assertPublic(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, "commerce_private_storage_exposed"); assertPublic(child); }
}
async function request(path, { method = "GET", headers = {}, body, status = 200 } = {}) {
  assert.ok(path.startsWith("/v1/") && !path.includes("\\"));
  requests++;
  const response = await fetch(new URL(path, owned.apiOrigin), { method, headers: { origin: owned.apiOrigin,
    ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (response.status !== status) phase("http_refusal", { at: stageName, status: response.status, expectedStatus: status,
    code: safeRefusalCodes.has(data?.code) ? data.code : "unlisted_problem_code" });
  assert.equal(response.status, status, `commerce_http_status:${method}:${path}`);
  assertPublic(data);
  return { data, headers: response.headers };
}
function assertProblem(response, status, code, title) {
  assert.equal(response.data.status, status);
  assert.equal(response.data.code, code);
  assert.equal(response.data.detail, code);
  assert.equal(response.data.title, title);
  assert.equal(response.data.type, `https://docs.aacp.dev/problems/${code}`);
  assert.match(response.headers.get("content-type") ?? "", /^application\/problem\+json(?:; charset=utf-8)?$/i);
}
async function row(cartId) {
  return owned.prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
}
const commercial = value => JSON.stringify({ items: value.items, total: value.total, discount: value.discount,
  freeShipping: value.freeShipping, couponCode: value.couponCode });

// Preconditions only: every suggestion, quote, acceptance and checkout below
// still comes through the real public controllers. Keep the original physical
// catalog untouched so new virtual cases cannot contaminate those controls.
async function scenarioCatalog(kind) {
  const configurations = {
    checkout_cross_sell_digital: ["digital", "digital"],
    checkout_cross_sell_service: ["service", "service"],
    checkout_cross_sell_mixed: ["physical", "digital"],
    checkout_cross_sell_scheduled_blocked: ["service", "service"],
  };
  const types = configurations[kind];
  if (!types) return owned.seed;
  const products = [];
  for (const [index, type] of types.entries()) {
    const productId = randomUUID(), variantId = randomUUID(), sku = `JOURNEY-${productId}`;
    const physical = type === "physical" || type === "food";
    const metadata = { ...(type === "digital" ? { downloadUrl: `https://example.invalid/${productId}.pdf` } : {}),
      ...(type === "service" ? { serviceType: "remoto" } : {}),
      ...(index === 1 ? { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single",
        items: [{ id: "large", name: "Grande", priceModifierInCents: 500 }] }] } : {}),
      ...(index === 1 && kind === "checkout_cross_sell_scheduled_blocked" ? { serviceSchedule: { timeZone: "UTC", durationMinutes: 30,
        slots: [{ id: "canonical-slot", date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), startTime: "12:00" }] } } : {}) };
    const name = `Produto sintetico ${kind} ${index}`;
    await owned.prisma.product.create({ data: { id: productId, merchantId, name, type, metadata, isActive: true,
      variants: { create: { id: variantId, sku, isActive: true,
        ...(physical ? { weightGrams: 500, heightCm: 10, widthCm: 15, lengthCm: 20 } : {}),
        price: { create: { basePriceInCents: 5000, costInCents: null, currency: "BRL" } },
        ...(physical ? { stock: { create: { quantity: 100, reserved: 0 } } } : {}) } } }, select: { id: true } });
    assert.equal(await owned.prisma.productStock.count({ where: { variantId } }), physical ? 1 : 0);
    products.push({ productId, variantId, sku, name, productType: type });
  }
  const promotion = await owned.prisma.crossSellPromotion.create({ data: { id: randomUUID(), merchantId,
    name: `Oferta sintetica ${kind}`, trigger: { sku_in_cart: [products[0].sku] }, recommendedSkus: [products[1].sku],
    discountPercent: 10, maxDiscountPercent: 10, status: "active", startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000) }, select: { id: true } });
  return { ...owned.seed, trigger: products[0], target: products[1], promotionId: promotion.id };
}

async function scenario(kind) {
  const { apiOrigin, buyerToken, buyerJwt, capabilities } = owned, seed = await scenarioCatalog(kind);
  const scheduled = kind === "checkout_cross_sell_scheduled_blocked";
  const normal = kind === "checkout_cross_sell_options" || kind.startsWith("checkout_cross_sell_");
  stageName = `${kind}:conversation`; phase(stageName);
  const conversation = (await request("/v1/storefront/conversations", { method: "POST", status: 201,
    body: { merchant_id: merchantId, buyer_access_token: buyerToken } })).data;
  const cartId = conversation.conversation_id, conversationToken = conversation.conversation_token;
  secrets.push(conversationToken);
  const conversationClaims = capabilities.verify(conversationToken, "storefront-conversation", apiOrigin);
  assert.equal(conversationClaims.merchantId, merchantId); assert.equal(conversationClaims.resourceId, cartId);
  assert.equal(conversationClaims.aiUserId, `buyer:${buyerId}`);
  const { productType: _triggerType, ...sourceTrigger } = seed.trigger;
  await seedInitialCommerceCart(owned.prisma, { merchantId, cartId, trigger: sourceTrigger });
  const storeHeaders = { authorization: `Bearer ${conversationToken}` };
  const getCart = async () => (await request(`/v1/storefront/cart/${cartId}?merchantId=${merchantId}`, { headers: storeHeaders })).data;
  const beforeForeign = commercial(await row(cartId)), foreignMerchant = randomUUID();
  assertProblem(await request(`/v1/storefront/cart/${cartId}?merchantId=${foreignMerchant}`, { headers: storeHeaders, status: 403 }),
    403, "conversation_access_denied", "Forbidden");
  assert.equal(commercial(await row(cartId)), beforeForeign, "foreign_cart_read_mutated_commerce");
  let merchandiseCents = 5000;
  if (kind === "cross_sell_options") {
    stageName = `${kind}:quote_accept_get`; phase(stageName);
    const prefix = `/v1/storefront/${merchantId}/cart/${cartId}/cross-sell`;
    const quoteRequest = { variantId: seed.target.variantId, promotionId: seed.promotionId, quantity: 1, selectedOptionItemIds: ["large"] };
    assertProblem(await request(`/v1/storefront/${foreignMerchant}/cart/${cartId}/cross-sell/quote`, { method: "POST", headers: storeHeaders,
      body: quoteRequest, status: 403 }), 403, "conversation_access_denied", "Forbidden");
    await request(`${prefix}/quote`, { method: "POST", headers: storeHeaders,
      body: { ...quoteRequest, selectedOptionItemIds: [] }, status: 422 });
    assert.equal(commercial(await row(cartId)), beforeForeign, "invalid_quote_wrote_cart");
    const quote = (await request(`${prefix}/quote`, { method: "POST", headers: storeHeaders, body: quoteRequest, status: 201 })).data;
    assert.equal(quote.merchantId, merchantId); assert.equal(quote.cartId, cartId);
    assert.equal(quote.originalUnitPriceCents, 5500); assert.equal(quote.maximumUnitPriceCents, 4950);
    assert.deepEqual(quote.selectedOptionItemIds, ["large"]);
    assert.equal(quote.quote.originalSubtotalCents, 10500); assert.equal(quote.quote.promotionDiscountCents, 550);
    assert.equal(quote.quote.subtotalCents, 9950); assert.equal(quote.quote.merchandiseTotalCents, 9950);
    const tampered = structuredClone(quote); tampered.maximumUnitPriceCents--;
    await request(`${prefix}/accept`, { method: "POST", headers: storeHeaders, body: { expectedQuote: tampered }, status: 422 });
    assert.equal(commercial(await row(cartId)), beforeForeign, "invalid_accept_wrote_cart");
    const accepted = (await request(`${prefix}/accept`, { method: "POST", headers: storeHeaders, body: { expectedQuote: quote }, status: 201 })).data;
    assert.deepEqual(accepted, { version: 1, status: "accepted", merchantId, cartId });
    const stored = await row(cartId), target = stored.items.find(line => line.variantId === seed.target.variantId);
    assert.ok(target); assert.equal(stored.items.length, 2); assert.equal(target.unitPriceCents, 5500);
    assert.equal(target.crossSellIntent.originalUnitPriceCents, 5500); assert.equal(target.crossSellIntent.maximumUnitPriceCents, 4950);
    assert.deepEqual(target.crossSellIntent.selectedOptionItemIds, ["large"]);
    const acceptedSnapshot = commercial(stored);
    // Duplicate is a definitive refusal, not an idempotent-success claim.
    await request(`${prefix}/accept`, { method: "POST", headers: storeHeaders, body: { expectedQuote: quote }, status: 422 });
    assert.equal(commercial(await row(cartId)), acceptedSnapshot, "duplicate_accept_changed_quantity_or_money");
    merchandiseCents = 9950;
  }
  const canonical = await getCart();
  assert.equal(canonical.cartId, cartId); assert.equal(cents(canonical.subtotal), merchandiseCents);
  assert.equal(cents(canonical.total), merchandiseCents); assert.equal(canonical.discount, 0);
  assert.equal(canonical.itemCount, kind === "cross_sell_options" ? 2 : 1);
  if (kind === "cross_sell_options") {
    const target = canonical.items.find(item => item.variantId === seed.target.variantId);
    assert.deepEqual(target.optionItemIds, ["large"]); assert.equal(cents(target.price), 4950); assert.equal(cents(target.originalPrice), 5500);
  }
  assert.deepEqual(await getCart(), canonical, "repeat_get_reapplied_or_changed_benefit");

  stageName = `${kind}:embed_issue_idempotency`; phase(stageName);
  const issueBody = { allowed_origin: apiOrigin, cart_ref: cartId, conversation_token: conversationToken,
    scopes: ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "payment:intents:create", "payment:intents:read", "payment:intents:confirm"] };
  const issueHeaders = { "x-internal-service-token": owned.internalServiceToken, "x-merchant-id": merchantId, "idempotency-key": randomUUID() };
  const issue = (await request("/v1/embed-sessions", { method: "POST", headers: issueHeaders, body: issueBody, status: 201 })).data;
  secrets.push(issue.embed_session_token);
  const replay = await request("/v1/embed-sessions", { method: "POST", headers: issueHeaders, body: issueBody, status: 201 });
  assert.equal(replay.data.embed_session_token, issue.embed_session_token); assert.equal(replay.headers.get("idempotency-replayed"), "true");
  await request("/v1/embed-sessions", { method: "POST", headers: issueHeaders, body: { ...issueBody, ttl_seconds: 800 }, status: 409 });
  const [{ EmbedTokenService }, { embedCheckoutSessionId }] = await Promise.all([
    compiled("modules/embed/domain/embed-token.service"), compiled("modules/embed/domain/embed-checkout-session")]);
  const claims = owned.app.get(EmbedTokenService, { strict: false }).verify(issue.embed_session_token);
  assert.equal(claims.merchantId, merchantId); assert.equal(claims.storefrontCartRef, cartId); assert.equal(claims.allowedOrigin, apiOrigin);
  const sessionId = embedCheckoutSessionId(claims), embedHeaders = { "x-aacp-embed-token": issue.embed_session_token };
  assert.notEqual(sessionId, cartId);
  const startBody = { session_id: sessionId, buyer_access_token: buyerToken,
    cart: { items: [], total: 0, currency: "BRL", source: "storefront" } };
  const start = async (headers = embedHeaders) => (await request("/v1/embed/start", { method: "POST", headers, body: startBody, status: 201 })).data;
  stageName = `${kind}:normal_embed_start_contact`; phase(stageName);
  await request("/v1/embed/start", { method: "POST", headers: embedHeaders, body: { ...startBody, session_id: randomUUID() }, status: 401 });
  const started = await start();
  assert.equal(started.session_id, sessionId); assert.equal(started.global_user_id, buyerId);
  assert.equal(cents(started.experience.totals.subtotal), merchandiseCents); assert.equal(started.experience.totals.discount, 0);
  let persisted = await owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  assert.equal(persisted.globalUserId, buyerId); assert.equal(persisted.customer.email_verified, true);
  assert.equal(persisted.customer.address_verified, true); assert.equal(persisted.cart.cart_ref, cartId);
  assert.equal(Object.hasOwn(persisted.cart, "_widgetCrossSellAcceptance"), false);
  if (kind === "cross_sell_options") {
    const target = persisted.cart.items.find(item => item.variantId === seed.target.variantId);
    assert.equal(cents(target.price), 4950); assert.equal(cents(target.originalPrice), 5500);
    assert.equal(target.selected_options[0].price_modifier, 5); assert.ok(target.crossSellIntent);
  }
  const customerResponse = (await request("/v1/embed/customer/update", { method: "POST", headers: embedHeaders,
    body: { session_id: sessionId, customer: seed.customer }, status: 201 })).data;
  assert.deepEqual(customerResponse, { ok: true });
  let normalCrossSell;
  if (normal) {
    stageName = `${kind}:normal_quote_accept_repeat`; phase(stageName);
    const limited = (await request("/v1/embed-sessions", { method: "POST",
      headers: { ...issueHeaders, "idempotency-key": randomUUID() },
      body: { ...issueBody, scopes: issueBody.scopes.filter(scope => scope !== "offers:apply") }, status: 201 })).data;
    secrets.push(limited.embed_session_token);
    normalCrossSell = await exerciseNormalCheckoutCrossSellHttp({ owned, request, merchantId, sessionId, cartId, headers: embedHeaders,
      unprivilegedHeaders: { "x-aacp-embed-token": limited.embed_session_token }, catalog: seed, scheduled });
    if (scheduled) return { kind, normalCheckout: true, canonicalRead: true, buyerHydrated: true, normalCrossSell,
      scheduledServiceBlocked: true, merchandiseCents: 5000, shipping: [] };
    merchandiseCents = normalCrossSell.merchandiseCents;
    const rereadSource = await getCart();
    assert.equal(cents(rereadSource.subtotal), merchandiseCents);
    assert.equal(rereadSource.itemCount, 2);
  }
  const remounted = await start(); assert.equal(cents(remounted.experience.totals.subtotal), merchandiseCents);
  assert.equal(await owned.prisma.checkoutSession.count({ where: { merchantId, sessionId } }), 1);

  const shipping = [];
  const actualCart = await owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  const virtual = actualCart.cart.items.length > 0 && actualCart.cart.items.every(item => item.productType === "digital" || item.productType === "service");
  assert.equal(remounted.experience.stage, virtual ? "payment" : "shipping");
  if (virtual) {
    assert.equal(actualCart.shipping, null); assert.equal(cents(remounted.experience.totals.shipping), 0);
    assert.equal(cents(remounted.experience.totals.total), merchandiseCents);
    assert.equal(cents(remounted.experience.totals.total_to_pay), merchandiseCents + cents(remounted.experience.totals.service_fee));
    assert.equal(await owned.prisma.shippingQuote.count({ where: { merchantId, sessionId } }), 0);
  }
  for (const mode of virtual ? [] : ["flat", "neighborhood"]) {
    stageName = `${kind}:shipping_${mode}`; phase(stageName);
    const expected = await configureOwnedCommerceDelivery(owned.prisma, merchantId, mode);
    const quote = (await request("/v1/embed/shipping/quote", { method: "POST", headers: embedHeaders,
      body: { session_id: sessionId, destination_zip: seed.address.zip }, status: 201 })).data;
    assert.equal(quote.session_id, sessionId); assert.equal(quote.merchant_id, merchantId);
    assert.equal(quote.results.length, 1); assert.equal(quote.results[0].carrier_key, expected.carrierKey);
    assert.equal(quote.results[0].price, expected.priceCents); assert.equal(quote.results[0].is_free, false);
    const repeated = (await request("/v1/embed/shipping/quote", { method: "POST", headers: embedHeaders,
      body: { session_id: sessionId, destination_zip: seed.address.zip }, status: 201 })).data;
    assert.equal(repeated.id, quote.id, "same_shipping_context_did_not_reuse_quote");
    await request("/v1/embed/shipping/select", { method: "POST", headers: embedHeaders,
      body: { session_id: sessionId, carrier_key: "foreign_unquoted_carrier" }, status: 400 });
    const selected = (await request("/v1/embed/shipping/select", { method: "POST", headers: embedHeaders,
      body: { session_id: sessionId, carrier_key: expected.carrierKey }, status: 201 })).data;
    assert.equal(cents(selected.shipping.customerPrice), expected.priceCents);
    const reread = await start(), totals = reread.experience.totals;
    assert.equal(cents(totals.subtotal), merchandiseCents); assert.equal(totals.discount, 0);
    assert.equal(cents(totals.shipping), expected.priceCents); assert.equal(cents(totals.total), merchandiseCents + expected.priceCents);
    assert.equal(cents(totals.total_to_pay), cents(totals.total) + cents(totals.service_fee));
    shipping.push({ mode, priceCents: expected.priceCents });
  }
  let neighborhoodOrigin;
  if (kind === "ordinary_legacy_canonical") {
    stageName = `${kind}:neighborhood_origin_authority`; phase(stageName);
    neighborhoodOrigin = await exerciseNeighborhoodOriginHttp({ owned, request, headers: embedHeaders, merchantId, sessionId, cartId });
  }
  stageName = `${kind}:payment_missing_connection`; phase(stageName);
  assert.equal(await owned.prisma.merchantPaymentConnection.count({ where: { merchantId } }), 0);
  const payment = (await request("/v1/embed/payment/intents", { method: "POST", headers: embedHeaders,
    body: { session_id: sessionId, idempotency_key: randomUUID(), method: "pix" }, status: 400 })).data;
  assert.equal(payment.status, 400);
  assert.equal(payment.code, "payment_provider_not_configured");
  assert.equal(payment.detail, "payment_provider_not_configured");
  assert.equal(payment.title, "Bad Request");
  assert.equal(payment.type, "https://docs.aacp.dev/problems/payment_provider_not_configured");
  assert.equal(await owned.prisma.paymentIntent.count({ where: { merchantId, sessionId } }), 0);
  assert.equal(await owned.prisma.completedOrder.count({ where: { merchantId, sessionId } }), 0);

  stageName = `${kind}:public_unpaid_recovery`; phase(stageName);
  process.env.PUBLIC_STOREFRONT_URL = apiOrigin;
  const { GenerateRecoveryLinkUseCase } = await compiled("modules/cart-recovery/application/use-cases/generate-recovery-link.use-case");
  const recoveryUrl = new URL(await owned.app.get(GenerateRecoveryLinkUseCase, { strict: false }).execute({ merchantId, sessionId }));
  const token = recoveryUrl.searchParams.get("recovery"); secrets.push(token); assert.ok(token);
  const recoveryPath = `/v1/storefront/journey-${runId}/recovery`;
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const recoveryCartBefore = digest(await row(cartId));
  const recoverySessionBefore = digest(await owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } }));
  async function assertRecoveryUnchanged() {
    assert.equal(digest(await row(cartId)), recoveryCartBefore, "refused_recovery_changed_source_cart");
    assert.equal(digest(await owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } })),
      recoverySessionBefore, "refused_recovery_changed_checkout");
    assert.equal(await owned.prisma.paymentIntent.count({ where: { merchantId, sessionId } }), 0);
    assert.equal(await owned.prisma.completedOrder.count({ where: { merchantId, sessionId } }), 0);
  }
  // Recovery rate limits are shared by handler/IP, not product type. Exercise
  // all three auth refusals on the three physical controls and valid recovery
  // on EVERY positive type: 15 real requests, no quota reset, spoofing or retry.
  const recoveryAuthRefusalsValidated = ["ordinary_legacy_canonical", "cross_sell_options", "checkout_cross_sell_options"].includes(kind);
  if (recoveryAuthRefusalsValidated) {
    stageName = `${kind}:recovery_missing_buyer`; phase(stageName);
    assertProblem(await request(recoveryPath, { method: "POST", body: { token }, status: 401 }),
      401, "recovery_buyer_login_required", "Unauthorized");
    await assertRecoveryUnchanged();
    const otherBuyerToken = buyerJwt.sign({ globalUserId: seed.otherBuyerId, merchantId, email: seed.otherBuyerEmail }); secrets.push(otherBuyerToken);
    stageName = `${kind}:recovery_wrong_buyer`; phase(stageName);
    assertProblem(await request(recoveryPath, { method: "POST", body: { token, buyer_access_token: otherBuyerToken }, status: 403 }),
      403, "recovery_buyer_mismatch", "Forbidden");
    await assertRecoveryUnchanged();
    stageName = `${kind}:recovery_wrong_origin`; phase(stageName);
    assertProblem(await request(recoveryPath, { method: "POST", headers: { origin: "http://127.0.0.1:9" }, body: { token, buyer_access_token: buyerToken }, status: 403 }),
      403, "recovery_origin_not_allowed", "Forbidden");
    await assertRecoveryUnchanged();
  }
  stageName = `${kind}:recovery_valid_buyer`; phase(stageName);
  const resumed = await request(recoveryPath, { method: "POST", body: { token, buyer_access_token: buyerToken }, status: 201 });
  secrets.push(resumed.data.embed_session_token);
  assert.equal(resumed.headers.get("cache-control"), "no-store"); assert.equal(resumed.headers.get("referrer-policy"), "no-referrer");
  const resumedClaims = owned.app.get(EmbedTokenService, { strict: false }).verify(resumed.data.embed_session_token);
  assert.equal(resumedClaims.recoveredCheckoutSessionId, sessionId);
  stageName = `${kind}:recovery_embed_start`; phase(stageName);
  const recovered = await start({ "x-aacp-embed-token": resumed.data.embed_session_token });
  assert.equal(recovered.session_id, sessionId); assert.equal(recovered.global_user_id, buyerId);
  assert.equal(cents(recovered.experience.totals.subtotal), merchandiseCents); assert.equal(recovered.experience.totals.discount, 0);
  assert.equal(recovered.experience.stage, virtual ? "payment" : "shipping");
  persisted = await owned.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
  assert.equal(persisted.shipping, null, "recovery_must_require_fresh_shipping_selection");
  assert.equal(await owned.prisma.checkoutSession.count({ where: { merchantId, sessionId } }), 1);
  return { kind, merchandiseCents, shipping, virtualDelivery: virtual, normalCheckout: true, canonicalRead: true, buyerHydrated: true,
    ...(normalCrossSell ? { normalCrossSell } : {}),
    ...(neighborhoodOrigin ? { neighborhoodOrigin } : {}),
    recoveredOriginalSession: true, recoveryAuthRefusalsValidated, negativePaymentWithoutConnection: true };
}

try {
  owned = await createOwnedStorefrontJourneyApp({ databaseUrl, databaseRunId, redisUrl, redisRunId, tree,
    runId, merchantId, buyerId, phase: "commerce-no-provider" });
  secrets.push(owned.buyerToken, owned.conversationToken, owned.internalServiceToken,
    owned.seed.customer.email, owned.seed.customer.cpf, owned.seed.customer.phone);
  assert.equal(new URL(owned.apiOrigin).hostname, "127.0.0.1");
  const scenarios = [];
  for (const kind of ["ordinary_legacy_canonical", "cross_sell_options", "checkout_cross_sell_options",
    "checkout_cross_sell_digital", "checkout_cross_sell_service", "checkout_cross_sell_mixed", "checkout_cross_sell_scheduled_blocked"])
    scenarios.push(await scenario(kind));
  assert.equal(await owned.prisma.paymentIntent.count({ where: { merchantId } }), 0);
  assert.equal(await owned.prisma.completedOrder.count({ where: { merchantId } }), 0);
  evidence = { phase: "commerce-no-provider", realHttpControllers: true, publicAddValidated: false,
    legacyUnprovenancedReducedCartValidated: false, acceptedWidgetReceiptActivated: false,
    paidJourneyValidated: false, actualPspValidated: false, scenarios, requests };
} catch (error) { failure = error; }
finally {
  if (owned) {
    try {
      const closed = await owned.close(), observed = owned.evidence();
      const providerCalls = observed.providerFactoryAttempts + observed.forbiddenFetches + observed.forbiddenSockets;
      assert.equal(providerCalls, 0, "commerce_external_provider_attempt_forbidden");
      if (evidence) Object.assign(evidence, observed, closed, { providerCalls });
    }
    catch (error) { failure = new AggregateError([...(failure ? [failure] : []), error], "commerce_owned_app_cleanup_failed"); }
  }
  delete process.env.PUBLIC_STOREFRONT_URL;
}
if (failure) {
  console.log("JOURNEY_COMMERCE_FAILURE " + JSON.stringify({ stage: stageName, failure: safeError(failure) }));
  process.exitCode = 1;
} else console.log("JOURNEY_COMMERCE_RESULT " + JSON.stringify(evidence));
