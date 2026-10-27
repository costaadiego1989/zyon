import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

/** Runs inside the existing owned, authenticated AppModule journey only.
 * SQL changes below are explicit synthetic address/config preconditions, not
 * identity verification, acceptance, quote, shipping or payment grants.
 * Quote-unavailable snapshots legitimately persist; refused SELECT/configuration
 * operations must not change commercial state (getRules may touch updatedAt).
 * No extra server, auth override or provider exists.
 */
export async function exerciseNeighborhoodOriginHttp({ owned, request, headers, merchantId, sessionId, cartId }) {
  assert.equal(new URL(owned.apiOrigin).hostname, "127.0.0.1");
  const prisma = owned.prisma, scope = { merchantId, sessionId };
  const checkout = () => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } });
  const source = () => prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
  const merchant = () => prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  const original = await checkout(), originalMerchant = await merchant();
  const config = await prisma.ownDeliveryConfig.findUniqueOrThrow({ where: { merchantId } });
  const rules = await prisma.merchantRule.findUniqueOrThrow({ where: { merchantId } });
  assert.equal(original.merchantId, merchantId); assert.equal(original.sessionId, sessionId);
  assert.equal(original.cart.cart_ref, cartId); assert.equal(original.customer.address_verified, true);
  assert.equal(config.enabled, true); assert.equal(config.mode, "neighborhood");
  assert.equal(config.freeAboveCents, null);
  const originalAddress = original.customer.address, settings = originalMerchant.storeSettings;
  const origin = settings.company.address;
  assert.equal(origin.zip.replace(/\D/g, ""), rules.originZip.replace(/\D/g, ""));
  assert.equal(originalAddress.zip.replace(/\D/g, ""), origin.zip.replace(/\D/g, ""));
  assert.equal(config.neighborhoods.length, 1);
  assert.equal(config.neighborhoods[0].name, "Bela Vista");
  const carrierKey = "own_delivery_neighborhood_bela_vista", priceCents = config.neighborhoods[0].priceCents;
  assert.equal(priceCents, 900);
  const originalSource = JSON.stringify(await source());
  const originalCart = JSON.stringify(original.cart);
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  let ruleReadTimestampAdvanced = false;
  const fingerprintBuckets = ["checkout", "source", "merchant", "rules", "config", "quotes", "events", "outbox", "payments", "orders", "coupons"];
  const fingerprint = async () => {
    const rows = await Promise.all([
    checkout(), source(), merchant(),
    prisma.merchantRule.findUniqueOrThrow({ where: { merchantId } }),
    prisma.ownDeliveryConfig.findUniqueOrThrow({ where: { merchantId } }),
    prisma.shippingQuote.findMany({ where: scope, orderBy: { id: "asc" } }),
    prisma.checkoutEvent.findMany({ where: scope, orderBy: { id: "asc" } }),
    // The real relay may advance delivery/lease state independently. Preserve
    // every immutable event/effect and detect INSERT/DELETE/payload changes,
    // without mistaking dispatch bookkeeping for a refused command's write.
    prisma.outboxMessage.findMany({ where: { merchantId }, orderBy: { eventId: "asc" }, select: {
      eventId: true, merchantId: true, eventType: true, producer: true, schemaVersion: true,
      payload: true, correlationId: true, causationId: true, occurredAt: true,
    } }),
    prisma.paymentIntent.findMany({ where: scope, orderBy: { id: "asc" } }),
    prisma.completedOrder.findMany({ where: scope, orderBy: { id: "asc" } }),
    prisma.couponRedemption.findMany({ where: scope, orderBy: { id: "asc" } }),
    ]);
    // getRules() uses upsert(update:{}); tenant scoping injects merchantId into
    // that update, and MerchantRule.updatedAt is Prisma @updatedAt. A quote may
    // therefore touch this technical timestamp before refusing. Keep EVERY
    // other rule field and compare the actual objects, never exempt commercial
    // changes or claim these controller reads perform zero SQL writes.
    const { updatedAt, ...ruleState } = rows[3];
    rows[3] = ruleState;
    return { hashes: Object.fromEntries(rows.map((value, index) => [fingerprintBuckets[index], digest(value)])),
      ruleState, ruleTimestamp: updatedAt.toISOString() };
  };
  const quote = async (body = {}, status = 201) => request("/v1/embed/shipping/quote", {
    method: "POST", headers, body: { session_id: sessionId, destination_zip: originalAddress.zip, ...body }, status,
  });
  const select = async (body = {}, status = 201) => request("/v1/embed/shipping/select", {
    method: "POST", headers, body: { session_id: sessionId, carrier_key: carrierKey, ...body }, status,
  });
  const setCustomer = customer => prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer } });
  const setAddress = address => setCustomer({ ...original.customer, address });
  const setOrigin = address => prisma.merchant.update({ where: { id: merchantId }, data: {
    storeSettings: { ...settings, company: { ...settings.company, address } },
  } });
  const assertProblem = (response, status, code, expectedDetail = code) => {
    assert.equal(response.data.status, status); assert.equal(response.data.code, code);
    assert.equal(response.data.detail, expectedDetail);
    assert.equal(response.data.type, `https://docs.aacp.dev/problems/${code}`);
    assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
  };
  const assertRefusedUnchanged = async (operation, status, code, label, expectedDetail = code) => {
    const before = await fingerprint();
    assertProblem(await operation(), status, code, expectedDetail);
    const after = await fingerprint();
    const changedTables = fingerprintBuckets.filter(bucket => after.hashes[bucket] !== before.hashes[bucket]);
    if (before.ruleTimestamp !== after.ruleTimestamp) {
      if (!isDeepStrictEqual(before.ruleState, after.ruleState)) {
        if (!changedTables.includes("rules")) changedTables.push("rules");
      } else ruleReadTimestampAdvanced = true;
    }
    if (changedTables.length) {
      // Fixed test labels/table names only; no row, hash, buyer/config value or
      // caller-provided text crosses the worker's diagnostic allowlist.
      const error = new Error(`neighborhood_http_${label}_refusal_wrote_state`);
      error.journeyChangedTables = changedTables;
      throw error;
    }
  };
  const assertAvailable = response => {
    assert.equal(response.data.merchant_id, merchantId); assert.equal(response.data.session_id, sessionId);
    assert.equal(response.data.results.length, 1);
    assert.equal(response.data.results[0].carrier_key, carrierKey);
    assert.equal(response.data.results[0].price, priceCents); assert.equal(response.data.results[0].is_free, false);
  };

  // Existing real scope/auth, not an alternate helper capability. Authentication
  // refuses before any quote or financial write, even with an actual carrier.
  await assertRefusedUnchanged(() => select({ session_id: randomUUID() }, 401), 401,
    "embed_checkout_session_binding_mismatch", "foreign_session");

  // Trim/case/diacritics/UF normalization uses actual server-owned rows. Keep the
  // configured district spelling/key; destination matching is exact-normalized.
  await setOrigin({ ...origin, city: "  SÃO  PAULO ", state: " sp " });
  await setAddress({ ...originalAddress, city: " sAo pAuLo ", state: "sp", neighborhood: " béLa  víSta " });
  const normalized = await quote(); assertAvailable(normalized);
  const selected = await select();
  assert.equal(Math.round(selected.data.shipping.customerPrice * 100), priceCents);
  assert.equal((await checkout()).shipping.carrier, carrierKey);

  // Revalidate a genuinely issued neighborhood candidate against the CURRENT
  // owned destination before selecting. A body city/merchant can never repair
  // missing, foreign-city or foreign-UF persisted authority.
  const missingCity = { ...originalAddress }; delete missingCity.city;
  const negativeAddresses = [
    ["missing_city", missingCity],
    ["foreign_city", { ...originalAddress, city: "Santos" }],
    ["foreign_state", { ...originalAddress, city: "Sao Paulo", state: "RJ" }],
  ];
  for (const [label, address] of negativeAddresses) {
    await setAddress(address);
    await assertRefusedUnchanged(() => select({ destination_city: "Sao Paulo", destination_state: "SP",
      destination_neighborhood: "Bela Vista", merchant_id: randomUUID() }, 409), 409,
    "shipping_quote_review_required", label);
  }

  // The company address alone cannot prove coverage: its CEP must agree with
  // this merchant's actual shipping-origin rule. Body origin fields are ignored.
  await setAddress(originalAddress);
  await setOrigin({ ...origin, zip: "11010000" });
  await assertRefusedUnchanged(() => quote({ origin_zip: rules.originZip, destination_city: "Sao Paulo" }, 400),
    400, "shipping_origin_address_configuration_required", "origin_zip_quote",
    "A loja precisa configurar o endereço da origem da entrega.");
  await assertRefusedUnchanged(() => select({}, 400), 400,
    "shipping_origin_address_configuration_required", "origin_zip_select", "Bad Request Exception");
  const missingOrigin = { ...origin }; delete missingOrigin.city;
  await setOrigin(missingOrigin);
  await assertRefusedUnchanged(() => quote({}, 400), 400,
    "shipping_origin_address_configuration_required", "origin_city_quote",
    "A loja precisa configurar o endereço da origem da entrega.");

  // A forged quotation body cannot create local coverage either. This endpoint
  // records an unavailable quote by design (NOT a no-write assertion); verify
  // actual persisted empty results and unchanged checkout/source instead.
  await setOrigin(origin);
  await setAddress({ ...originalAddress, city: "Santos" });
  const beforeUnavailableCheckout = JSON.stringify(await checkout());
  const unavailable = await quote({ destination_city: "Sao Paulo", destination_state: "SP",
    destination_neighborhood: "Bela Vista", origin_zip: origin.zip, cart_total: 0, free_shipping_threshold: 0 });
  assert.deepEqual(unavailable.data.results, []);
  const unavailableRow = await prisma.shippingQuote.findUniqueOrThrow({ where: { id: unavailable.data.id } });
  assert.equal(unavailableRow.merchantId, merchantId); assert.equal(unavailableRow.sessionId, sessionId);
  assert.deepEqual(unavailableRow.results, []); assert.equal(unavailableRow.selectedCarrierKey, null);
  const unavailableEvents = await prisma.outboxMessage.findMany({ where: { merchantId,
    eventType: "shipping.quote.created", causationId: unavailable.data.id }, orderBy: { eventId: "asc" } });
  assert.equal(unavailableEvents.length, 1);
  assert.equal(unavailableEvents[0].payload.session_id, sessionId);
  assert.equal(unavailableEvents[0].payload.quote_id, unavailable.data.id);
  assert.equal(unavailableEvents[0].payload.option_count, 0);
  assert.equal(JSON.stringify(await checkout()), beforeUnavailableCheckout, "unavailable_quote_changed_checkout");
  assert.equal(JSON.stringify(await source()), originalSource, "neighborhood_http_changed_source_commerce");
  await assertRefusedUnchanged(() => select({}, 400), 400,
    "shipping_carrier_not_in_quote", "unavailable_candidate");

  // Restore owned customer/config data and a CURRENT real selection for the
  // existing payment/recovery scenario. A distinct equivalent city context
  // creates a fresh quote instead of reusing an older row behind the empty one.
  await setAddress({ ...originalAddress, city: "  São Paulo   " });
  const restored = await quote(); assertAvailable(restored);
  assert.notEqual(restored.data.id, unavailable.data.id);
  await select();
  await setCustomer(original.customer);
  await prisma.merchant.update({ where: { id: merchantId }, data: { storeSettings: settings } });
  const final = await checkout();
  assert.deepEqual(final.customer, original.customer);
  assert.deepEqual((await merchant()).storeSettings, settings);
  assert.deepEqual(await prisma.ownDeliveryConfig.findUniqueOrThrow({ where: { merchantId } }), config);
  assert.equal(JSON.stringify(final.cart), originalCart);
  assert.equal(JSON.stringify(await source()), originalSource);
  assert.equal(final.shipping.carrier, carrierKey); assert.equal(Math.round(final.shipping.customerPrice * 100), priceCents);
  assert.equal(await prisma.paymentIntent.count({ where: scope }), 0);
  assert.equal(await prisma.completedOrder.count({ where: scope }), 0);
  return { sameCityNormalized: true, foreignSessionRefusedNoWrites: true,
    missingCityRefusedNoWrites: true, foreignCityRefusedNoWrites: true, foreignStateRefusedNoWrites: true,
    forgedBodyCannotGrantCoverage: true, originZipBound: true, originMissingCityRefusedNoWrites: true,
    unavailableQuoteRecordedNotFinancialMutation: true, sourceCommercePreserved: true,
    customerAndOriginRestored: true, currentSelectionRestored: true,
    ruleReadTimestampMayAdvance: true, ruleReadTimestampAdvanced };
}
