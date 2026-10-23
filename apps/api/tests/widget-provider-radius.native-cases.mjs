import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";

/** Called only by the existing guarded disposable checkout worker. This helper
 * creates NO client/container/bridge, reads no env, invokes no supplier and never
 * runs standalone. Synthetic result evidence is NOT real geocoding or payment. */
export async function runWidgetProviderRadiusNativeCases({ prisma, scope, adapter, resetManualShipping,
  request, address, contact, check, runId, observeWaiters = () => {} }) {
  assert.deepEqual(scope, { merchantId: "synthetic-merchant", sessionId: "synthetic-checkout" });
  assert.match(runId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  const { PrismaWidgetCheckoutProviderShippingRepository } = await import("../src/modules/cross-sell/infrastructure/repositories/prisma-widget-checkout-provider-shipping.repository.ts");
  const { PrismaWidgetCrossSellCheckoutAdapter } = await import("../src/modules/cross-sell/infrastructure/repositories/prisma-widget-cross-sell-checkout.adapter.ts");
  const repository = new PrismaWidgetCheckoutProviderShippingRepository(prisma), gateKey = 7396501;
  const applicationName = `aacp_write_native_${runId}`;
  // Fixed synthetic-only DDL after marker verification, never a production migration.
  await prisma.$executeRaw`ALTER TABLE merchant_rules ADD COLUMN IF NOT EXISTS origin_zip TEXT`;
  await prisma.$executeRaw`CREATE TABLE synthetic_widget_radius_control(mode TEXT NOT NULL)`;
  await prisma.$executeRaw`INSERT INTO synthetic_widget_radius_control VALUES ('off')`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_widget_radius_cart_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.shipping_options->>'origin'='widget_checkout_provider' AND NEW.version<>OLD.version
      AND (SELECT mode FROM synthetic_widget_radius_control)='cas' THEN RETURN NULL; END IF; RETURN NEW; END $$`);
  await prisma.$executeRaw`CREATE TRIGGER synthetic_widget_radius_cart_fault BEFORE UPDATE ON checkout_sessions
    FOR EACH ROW EXECUTE FUNCTION synthetic_widget_radius_cart_fault()`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_widget_radius_event_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE control TEXT; BEGIN
      IF NEW.event_name LIKE 'cross_sell_checkout_provider_shipping_%' THEN
        SELECT mode INTO control FROM synthetic_widget_radius_control;
        IF control='event' THEN RAISE EXCEPTION 'synthetic_radius_event_fault'; END IF;
        IF control='gate' THEN PERFORM pg_advisory_xact_lock(7396501); END IF;
      END IF; RETURN NEW; END $$`);
  await prisma.$executeRaw`CREATE TRIGGER synthetic_widget_radius_event_fault BEFORE INSERT ON checkout_events
    FOR EACH ROW EXECUTE FUNCTION synthetic_widget_radius_event_fault()`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_widget_radius_deferred_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_name LIKE 'cross_sell_checkout_provider_shipping_%'
      AND (SELECT mode FROM synthetic_widget_radius_control)='deferred' THEN
      RAISE EXCEPTION 'synthetic_radius_deferred_fault'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRaw`CREATE CONSTRAINT TRIGGER synthetic_widget_radius_deferred_fault AFTER INSERT ON checkout_events
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_widget_radius_deferred_fault()`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_widget_radius_selection_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE control TEXT; BEGIN IF NEW.event_name='cross_sell_checkout_manual_shipping_selected' THEN
      SELECT mode INTO control FROM synthetic_widget_radius_control;
      IF control='selection_event' THEN RAISE EXCEPTION 'synthetic_radius_selection_event_fault'; END IF;
      IF control='selection_gate' THEN PERFORM pg_advisory_xact_lock(7396501); END IF;
    END IF; RETURN NEW; END $$`);
  await prisma.$executeRaw`CREATE TRIGGER synthetic_widget_radius_selection_fault BEFORE INSERT ON checkout_events
    FOR EACH ROW EXECUTE FUNCTION synthetic_widget_radius_selection_fault()`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_widget_radius_selection_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_name='cross_sell_checkout_manual_shipping_selected'
      AND (SELECT mode FROM synthetic_widget_radius_control)='selection_deferred' THEN
      RAISE EXCEPTION 'synthetic_radius_selection_deferred_fault'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRaw`CREATE CONSTRAINT TRIGGER synthetic_widget_radius_selection_deferred AFTER INSERT ON checkout_events
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_widget_radius_selection_deferred()`;
  const setMode = mode => prisma.$executeRaw`UPDATE synthetic_widget_radius_control SET mode=${mode}`;
  const snapshot = async () => ({ row: await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } }),
    events: await prisma.checkoutEvent.findMany({ where: scope, orderBy: { id: "asc" } }),
    outbox: await prisma.outboxMessage.findMany({ where: { merchantId: scope.merchantId }, orderBy: { eventId: "asc" } }) });
  async function prepare() {
    await setMode("off"); await prisma.completedOrder.deleteMany({ where: scope }); await resetManualShipping();
    await prisma.$executeRaw`UPDATE merchant_rules SET origin_zip='01001000' WHERE merchant_id=${scope.merchantId}`;
    await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='radius',flat_price_cents=NULL,free_above_cents=10000,
      radius_zones='[{"maxKm":10,"priceCents":900},{"maxKm":null,"priceCents":1500}]'::jsonb,updated_at=clock_timestamp()
      WHERE merchant_id=${scope.merchantId}`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
  }
  const resultFor = pending => ({ requestId: pending.requestId, expiresAt: pending.expiresAt, mode: "radius",
    options: [{ carrier_key: "own_delivery_radius", label: "Entrega própria", price: 900, eta_days: 1 }],
    evidence: { kind: "cep_haversine", originZip: "01001000", destinationZip: address.zip, distanceKm: 5 } });
  const uncertainRepository = () => {
    const error = new Error("synthetic_radius_commit_ack_lost"); let calls = 0;
    return { error, calls: () => calls, repository: new PrismaWidgetCheckoutProviderShippingRepository(new Proxy(prisma, { get(client, key) {
      if (key === "$transaction") return async (...args) => { await client.$transaction(...args); calls++; throw error; };
      const member = Reflect.get(client, key); return typeof member === "function" ? member.bind(client) : member;
    } })) };
  };
  async function waitFor(query) {
    const deadline = Date.now() + 8000;
    do { const count = await query(); if (count > 0) { observeWaiters(count); return; } await pause(20); } while (Date.now() < deadline);
    assert.fail("actual_radius_lock_waiter_required");
  }
  const waitGate = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE a.application_name=${applicationName} AND NOT l.granted AND l.locktype='advisory' AND l.classid=0 AND l.objid=${gateKey}::oid`)[0].n);
  const waitConfig = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_stat_activity
    WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM own_delivery_configs%'`)[0].n);
  const waitMerchant = () => waitFor(async () => (await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM pg_stat_activity
    WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM merchants%'`)[0].n);
  async function hold(acquire, mutate = async () => {}) {
    let ready, rejectReady, release;
    const acquired = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; }), freed = new Promise(resolve => { release = resolve; });
    const done = prisma.$transaction(async tx => { await acquire(tx); ready(); await freed; await mutate(tx); }, { timeout: 15000 });
    void done.catch(rejectReady); await acquired; return { done, release };
  }

  await check("radius repository commits pending source/config/package hashes and request reference before dispatch", async () => {
    await prepare(); const started = await repository.begin(scope, { expectedVersion: 5 }), saved = await snapshot();
    assert.equal(saved.row.version, 6); assert.equal(saved.row.shipping, null); assert.deepEqual(saved.row.shippingOptions, started.pending);
    assert.equal(started.pending.sources.buyerId, saved.row.globalUserId); assert.equal(started.dispatch.requestId, started.pending.requestId);
    assert.equal(started.dispatch.mode, "radius"); assert.equal(started.dispatch.originZip, "01001000");
    const revision = saved.row.cart._widgetCrossSellAcceptance.revision;
    assert.equal(revision.providerRequestId, started.pending.requestId);
    assert.match(revision.providerSnapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(saved.events.find(event => event.id === revision.eventId).metadata.provider_request_id, started.pending.requestId);
    assert.equal(saved.events.find(event => event.id === revision.eventId).metadata.provider_snapshot_hash, revision.providerSnapshotHash);
    assert.deepEqual(await adapter.readAccepted(scope).then(cart => cart.total), 118);
  });
  await check("radius completion commits raw tariff without applying free threshold or selecting shipping", async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 });
    const completed = await repository.complete(scope, pending.requestId, resultFor(pending)), saved = await snapshot();
    assert.equal(completed.state, "completed"); assert.equal(saved.row.version, 7); assert.equal(saved.row.shipping, null);
    assert.equal(completed.result.options[0].price, 900); assert.equal(saved.row.cart._widgetCrossSellAcceptance.revision.providerRequestId, pending.requestId);
    await adapter.updateCustomer(scope, { expectedVersion: 7, customer: { ...contact, fullName: "Updated Buyer" } });
    const next = await repository.begin(scope, { expectedVersion: 8 }); assert.notEqual(next.pending.requestId, pending.requestId);
    const historical = saved.events.filter(event => event.eventName.includes("provider_shipping"));
    assert.equal(historical.length, 2); assert.ok(historical.every(event => event.metadata.provider_request_id === pending.requestId));
  });
  for (const tamper of ["hash", "ambiguous"]) await check("radius new begin requires unambiguous exact historical completion after permitted customer edit: " + tamper, async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 });
    await repository.complete(scope, pending.requestId, resultFor(pending));
    await adapter.updateCustomer(scope, { expectedVersion: 7, customer: { ...contact, fullName: "Updated Buyer" } });
    const event = (await snapshot()).events.find(row => row.eventName === "cross_sell_checkout_provider_shipping_completed");
    if (tamper === "hash") await prisma.checkoutEvent.update({ where: { id: event.id }, data: { metadata: { ...event.metadata, provider_snapshot_hash: "f".repeat(64) } } });
    else await prisma.checkoutEvent.create({ data: { id: "synthetic-radius-ambiguous", ...scope, eventName: event.eventName,
      occurredAt: event.occurredAt, metadata: event.metadata } });
    const before = await snapshot(); await assert.rejects(repository.begin(scope, { expectedVersion: 8 })); assert.deepEqual(await snapshot(), before);
  });
  await check("radius unknown is durable and cannot be restarted or completed automatically", async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 });
    assert.equal((await repository.markUnknown(scope, pending.requestId)).state, "unknown"); const before = await snapshot();
    await assert.rejects(repository.begin(scope, { expectedVersion: 7 })); await assert.rejects(repository.complete(scope, pending.requestId, resultFor(pending)));
    assert.deepEqual(await snapshot(), before);
  });
  await check("standing pending blocks second begin before supplier dispatch", async () => {
    await prepare(); await repository.begin(scope, { expectedVersion: 5 }); const before = await snapshot();
    await assert.rejects(repository.begin(scope, { expectedVersion: 6 })); assert.deepEqual(await snapshot(), before);
  });
  for (const kind of ["config", "generation", "origin", "package", "price"]) await check("radius completion revalidates current SQL source and preserves pending on " + kind + " drift", async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 });
    if (kind === "config") await prisma.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=10001 WHERE merchant_id=${scope.merchantId}`;
    if (kind === "generation") await prisma.$executeRaw`UPDATE own_delivery_configs SET updated_at=updated_at+interval '1 millisecond' WHERE merchant_id=${scope.merchantId}`;
    if (kind === "origin") await prisma.$executeRaw`UPDATE merchant_rules SET origin_zip='02002000' WHERE merchant_id=${scope.merchantId}`;
    if (kind === "package") await prisma.$executeRaw`UPDATE product_variants SET weight_grams=500 WHERE id='target'`;
    if (kind === "price") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2001 WHERE variant_id='target'`;
    const before = await snapshot(); await assert.rejects(repository.complete(scope, pending.requestId, resultFor(pending)));
    await assert.rejects(repository.markUnknown(scope, pending.requestId)); assert.deepEqual(await snapshot(), before);
  });
  for (const phase of ["begin", "complete", "unknown"]) for (const failure of ["cas", "event", "deferred"])
  await check("radius actual SQL row/event/commit rollback is atomic: " + phase + "/" + failure, async () => {
    await prepare(); const pending = phase === "begin" ? null : (await repository.begin(scope, { expectedVersion: 5 })).pending;
    const before = await snapshot(); await setMode(failure);
    try {
      await assert.rejects(phase === "begin" ? repository.begin(scope, { expectedVersion: 5 }) : phase === "complete"
        ? repository.complete(scope, pending.requestId, resultFor(pending)) : repository.markUnknown(scope, pending.requestId));
      assert.deepEqual(await snapshot(), before);
    } finally { await setMode("off"); }
  });
  for (const phase of ["begin", "complete", "unknown"]) await check("radius lost real-commit ACK propagates once and never redispatches: " + phase, async () => {
    await prepare(); const pending = phase === "begin" ? null : (await repository.begin(scope, { expectedVersion: 5 })).pending;
    const uncertain = uncertainRepository();
    await assert.rejects(phase === "begin" ? uncertain.repository.begin(scope, { expectedVersion: 5 }) : phase === "complete"
      ? uncertain.repository.complete(scope, pending.requestId, resultFor(pending)) : uncertain.repository.markUnknown(scope, pending.requestId), error => error === uncertain.error);
    assert.equal(uncertain.calls(), 1); const before = await snapshot();
    assert.equal(before.row.shippingOptions.state, phase === "begin" ? "pending" : phase === "complete" ? "completed" : "unknown");
    if (phase === "begin") await assert.rejects(repository.begin(scope, { expectedVersion: 6 }));
    else await assert.rejects(phase === "complete" ? repository.complete(scope, pending.requestId, resultFor(pending)) : repository.markUnknown(scope, pending.requestId));
    assert.deepEqual(await snapshot(), before);
  });
  for (const firstUnknown of [true, false]) await check("radius complete/unknown real row wait admits one terminal generation: " + firstUnknown, async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 }); await setMode("gate");
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const terminal = unknown => unknown ? repository.markUnknown(scope, pending.requestId) : repository.complete(scope, pending.requestId, resultFor(pending));
    const first = terminal(firstUnknown); void first.catch(() => {}); let second;
    try { await waitGate(); second = terminal(!firstUnknown); void second.catch(() => {}); await waitMerchant(); }
    finally { gate.release(); await gate.done; await Promise.allSettled([first, ...(second ? [second] : [])]); await setMode("off"); }
    assert.equal((await first).state, firstUnknown ? "unknown" : "completed"); await assert.rejects(second);
    assert.equal((await snapshot()).row.version, 7);
  });
  await check("radius configuration writer first forces begin to reread locked SQL tariff", async () => {
    await prepare(); const writer = await hold(tx => tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`,
      tx => tx.$executeRaw`UPDATE own_delivery_configs SET enabled=false WHERE merchant_id=${scope.merchantId}`);
    const pending = repository.begin(scope, { expectedVersion: 5 }); void pending.catch(() => {});
    try { await waitConfig(); } finally { writer.release(); await writer.done; }
    await assert.rejects(pending); assert.equal((await snapshot()).row.version, 5);
  });
  await check("radius begin first holds config through commit; later changed source cannot complete old generation", async () => {
    await prepare(); await setMode("gate"); const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const pending = repository.begin(scope, { expectedVersion: 5 }); void pending.catch(() => {}); let writer;
    try {
      await waitGate(); writer = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`;
        await tx.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=10001 WHERE merchant_id=${scope.merchantId}`;
      }, { timeout: 15000 }); void writer.catch(() => {}); await waitConfig();
    } finally { gate.release(); await gate.done; await Promise.allSettled([pending, ...(writer ? [writer] : [])]); await setMode("off"); }
    const { pending: envelope } = await pending; await writer; const before = await snapshot();
    await assert.rejects(repository.complete(scope, envelope.requestId, resultFor(envelope))); assert.deepEqual(await snapshot(), before);
  });
  for (const unknown of [false, true]) await check("radius outstanding operation survives all existing mutation commands; cart remains readable: " + unknown, async () => {
    await prepare(); const { pending } = await repository.begin(scope, { expectedVersion: 5 });
    if (unknown) await repository.markUnknown(scope, pending.requestId);
    const expectedVersion = unknown ? 7 : 6, before = await snapshot();
    const commands = [() => adapter.updateCustomer(scope, { expectedVersion, customer: contact }),
      () => adapter.updateAddress(scope, { expectedVersion, address }), () => adapter.verifyEmailOtp(scope, { expectedVersion, code: "123456" }),
      () => adapter.requestEmailOtp(scope, { expectedVersion, action: "issue" }),
      () => adapter.claimEmailOtpDelivery(scope, { expectedVersion, deliveryId: "a5537938-7496-4ea4-94b4-ec872a418337" }),
      () => adapter.quoteManualShipping(scope, { expectedVersion }),
      () => adapter.selectManualShipping(scope, { expectedVersion, quoteId: "a5537938-7496-4ea4-94b4-ec872a418337", carrierKey: "own_delivery_radius" })];
    for (const command of commands) await assert.rejects(command(), /cross_sell_quote_review_required/);
    assert.equal((await adapter.readAccepted(scope)).total, 118); assert.deepEqual(await snapshot(), before);
  });

  const { readAcceptedWidgetCheckoutInTransaction } = await import("../src/modules/cross-sell/infrastructure/repositories/widget-checkout-accepted-reader.ts");
  const readCurrent = () => prisma.$transaction(tx => readAcceptedWidgetCheckoutInTransaction(tx, scope));
  async function completedSelection(waiver = false) {
    await prepare();
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer: { ...contact, email_verified: true, address, address_verified: true } } });
    if (!waiver) await prisma.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=NULL WHERE merchant_id=${scope.merchantId}`;
    else await prisma.$executeRaw`UPDATE merchant_rules SET allow_free_shipping=true,allow_stack_discount_and_free_shipping=true,
      max_shipping_subsidy=9 WHERE merchant_id=${scope.merchantId}`;
    const { pending } = await repository.begin(scope, { expectedVersion: 5 }); await repository.complete(scope, pending.requestId, resultFor(pending));
    return { pending, selection: { expectedVersion: 7, quoteId: pending.requestId, carrierKey: "own_delivery_radius" } };
  }
  await check("radius paid selection uses existing command/marker and canonical same-TX payment shipping reader", async () => {
    const { pending, selection } = await completedSelection(); await adapter.selectManualShipping(scope, selection);
    const selected = await adapter.readAcceptedShipping(scope), current = await readCurrent(), saved = await snapshot();
    assert.equal(selected.customerPrice, 9); assert.deepEqual(current.selectedShipping, selected); assert.equal(saved.row.version, 8);
    assert.equal(saved.row.cart._widgetCrossSellAcceptance.revision.operation, "manual_shipping_select");
    assert.deepEqual(saved.row.shipping._widgetManualSelection, { quoteId: pending.requestId, carrierKey: "own_delivery_radius" });
    assert.equal(saved.row.shippingOptions.result.options[0].price, 900); assert.equal("realCost" in saved.row.shipping, false);
  });
  await check("radius configured waiver is authorized by actual subsidy/stacking limits without rewriting raw paid tariff", async () => {
    const { selection } = await completedSelection(true); await adapter.selectManualShipping(scope, selection);
    assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 0); assert.equal((await readCurrent()).selectedShipping.customerPrice, 0);
    assert.equal((await snapshot()).row.shippingOptions.result.options[0].price, 900);
  });
  for (const policy of ["free", "stack", "subsidy", "minimum", "region"]) await check("radius selection cannot bypass actual configured waiver policy: " + policy, async () => {
    const { selection } = await completedSelection(true);
    if (policy === "free") await prisma.$executeRaw`UPDATE merchant_rules SET allow_free_shipping=false WHERE merchant_id=${scope.merchantId}`;
    if (policy === "stack") await prisma.$executeRaw`UPDATE merchant_rules SET allow_stack_discount_and_free_shipping=false WHERE merchant_id=${scope.merchantId}`;
    if (policy === "subsidy") await prisma.$executeRaw`UPDATE merchant_rules SET max_shipping_subsidy=8.99 WHERE merchant_id=${scope.merchantId}`;
    if (policy === "minimum") await prisma.$executeRaw`UPDATE merchant_rules SET free_shipping_min_cart_value=119 WHERE merchant_id=${scope.merchantId}`;
    if (policy === "region") await prisma.$executeRaw`UPDATE merchant_rules SET blocked_regions=ARRAY['SP']::text[] WHERE merchant_id=${scope.merchantId}`;
    const before = await snapshot(); await assert.rejects(adapter.selectManualShipping(scope, selection)); assert.deepEqual(await snapshot(), before);
  });
  await check("radius selected shipping survives proved contact-only revision with exact current receipt versions", async () => {
    const { selection } = await completedSelection(); await adapter.selectManualShipping(scope, selection);
    await adapter.updateCustomer(scope, { expectedVersion: 8, customer: { ...contact, fullName: "Updated Buyer" } });
    assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 9); assert.equal((await readCurrent()).stored.version, 9);
    const before = await snapshot(); await assert.rejects(adapter.selectManualShipping(scope, selection)); assert.deepEqual(await snapshot(), before);
  });
  for (const failure of ["cas", "selection_event", "selection_deferred"]) await check("radius actual selection CAS/event/commit rollback retains source and no selected shipping: " + failure, async () => {
    const { selection } = await completedSelection(), before = await snapshot(); await setMode(failure);
    try {
      await assert.rejects(adapter.selectManualShipping(scope, selection), error => {
        if (failure === "cas") assert.match(error.message, /cross_sell_quote_review_required/);
        else assert.match(`${error.message} ${JSON.stringify(error.meta ?? {})}`, new RegExp("synthetic_radius_" + failure + "_fault"));
        return true;
      });
      assert.deepEqual(await snapshot(), before);
    } finally { await setMode("off"); }
  });
  await check("radius selection lost real-commit ACK is recovered by canonical read, never retried against stale version", async () => {
    const { selection } = await completedSelection(), fault = new Error("synthetic_radius_selection_ack_lost"); let calls = 0;
    const uncertain = new PrismaWidgetCrossSellCheckoutAdapter(new Proxy(prisma, { get(client, key) {
      if (key === "$transaction") return async (...args) => { await client.$transaction(...args); calls++; throw fault; };
      const member = Reflect.get(client, key); return typeof member === "function" ? member.bind(client) : member;
    } }));
    await assert.rejects(uncertain.selectManualShipping(scope, selection), error => error === fault); assert.equal(calls, 1);
    const before = await snapshot(); assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 9);
    await assert.rejects(adapter.selectManualShipping(scope, selection)); assert.deepEqual(await snapshot(), before);
  });
  await check("radius competing selections physically wait and commit only one exact expected-version write", async () => {
    const { selection } = await completedSelection(); await setMode("selection_gate");
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const first = adapter.selectManualShipping(scope, selection); void first.catch(() => {}); let second;
    try { await waitGate(); second = adapter.selectManualShipping(scope, selection); void second.catch(() => {}); await waitMerchant(); }
    finally { gate.release(); await gate.done; await Promise.allSettled([first, ...(second ? [second] : [])]); await setMode("off"); }
    assert.equal((await first).persistenceVersion, 8); await assert.rejects(second); assert.equal((await snapshot()).row.version, 8);
  });
  await check("radius config writer first forces selection to revalidate after actual config-row wait", async () => {
    const { selection } = await completedSelection();
    const writer = await hold(tx => tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`,
      tx => tx.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=1 WHERE merchant_id=${scope.merchantId}`);
    const pending = adapter.selectManualShipping(scope, selection); void pending.catch(() => {});
    try { await waitConfig(); } finally { writer.release(); await writer.done; }
    await assert.rejects(pending); assert.equal((await snapshot()).row.shipping, null);
  });
  await check("radius selection first holds config through commit then read/payment refuse later config drift without repair", async () => {
    const { selection } = await completedSelection(); await setMode("selection_gate");
    const gate = await hold(tx => tx.$executeRaw`SELECT pg_advisory_xact_lock(${gateKey}::bigint)`);
    const pending = adapter.selectManualShipping(scope, selection); void pending.catch(() => {}); let writer;
    try {
      await waitGate(); writer = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`;
        await tx.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=1 WHERE merchant_id=${scope.merchantId}`;
      }, { timeout: 15000 }); void writer.catch(() => {}); await waitConfig();
    } finally { gate.release(); await gate.done; await Promise.allSettled([pending, ...(writer ? [writer] : [])]); await setMode("off"); }
    await pending; await writer; const before = await snapshot(); assert.equal(before.row.shipping.customerPrice, 9);
    await assert.rejects(adapter.readAcceptedShipping(scope)); await assert.rejects(readCurrent()); assert.deepEqual(await snapshot(), before);
  });
  const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const { createWidgetCheckoutPaymentAdmission } = await import("../src/modules/payment/infrastructure/prisma-widget-checkout-payment-admission.ts");
  const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const paymentRepo = new PrismaPaymentRepository(prisma, undefined, createWidgetCheckoutPaymentAdmission(readAcceptedWidgetCheckoutInTransaction, () => 149));
  const checkout = new PrismaCheckoutRepository(prisma);
  const completion = new CompleteOrderUseCase(checkout, checkout, checkout, undefined, undefined, undefined, undefined, checkout,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(prisma));
  let paymentSequence = 0;
  for (const waiver of [false, true]) await check("radius selected shipping enters actual journal/first-send/paid frozen order with exact fee exclusion: " + waiver, async () => {
    const { selection } = await completedSelection(waiver); await adapter.selectManualShipping(scope, selection); const current = await readCurrent();
    const shippingCents = waiver ? 0 : 900, totalCents = 11800 + shippingCents + 149, expectedOrderTotal = (11800 + shippingCents) / 100;
    const breakdown = { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint({ cart: current.projectedCart, shipping: current.selectedShipping }),
      itemsSubtotalCents: 11800, discountCents: 0, shippingCents, platformFeeCents: 149, totalCents };
    const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: `synthetic-radius-payment-${++paymentSequence}`,
      amountCents: totalCents, amountBreakdown: breakdown, currency: "BRL", method: "pix" });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: totalCents, currency: "BRL", method: "pix" });
    await paymentRepo.saveIntent({ intent });
    const admitted = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    assert.equal(admitted.creation.widgetCheckoutAuthority.frozenProjection.shipping.customerPrice, shippingCents / 100);
    intent.claimCreation("synthetic-radius-first-send", new Date()); await paymentRepo.saveIntent({ intent });
    intent.completeCreation("synthetic-radius-first-send");
    const provider = `synthetic-radius-paid-${paymentSequence}`;
    intent.markApproved({ providerPaymentId: provider, approvedAmountCents: totalCents }); await paymentRepo.saveIntent({ intent });
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id='target'`;
    await prisma.$executeRaw`UPDATE checkout_sessions SET shipping=NULL,shipping_options=NULL,version=version+1,
      strategy_context_version=strategy_context_version+1 WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}`;
    const input = { merchant_id: scope.merchantId, session_id: scope.sessionId, external_order_id: provider, order_total: expectedOrderTotal, currency: "BRL" };
    assert.equal((await completion.executePaymentApproval(input, intent.id)).idempotent, false);
    const orders = await prisma.completedOrder.findMany({ where: scope }); assert.equal(orders.length, 1);
    assert.equal(Number(orders[0].orderTotal), expectedOrderTotal); assert.equal(orders[0].shippingCents, shippingCents);
    assert.deepEqual(orders[0].lineItemsJson.map(line => [line.sku, line.unitPriceCents, line.quantity]),
      admitted.creation.widgetCheckoutAuthority.frozenProjection.cart.items.map(line => [line.sku, Math.round(line.price * 100), line.quantity]));
    const confirmations = await prisma.outboxMessage.findMany({ where: { merchantId: scope.merchantId, eventType: "order.confirmed" } });
    assert.equal(confirmations.length, 1); assert.equal(confirmations[0].payload.buyerEmail, contact.email);
    const before = await prisma.outboxMessage.count(); assert.equal((await completion.executePaymentApproval(input, intent.id)).idempotent, true);
    assert.equal(await prisma.outboxMessage.count(), before);
  });
  await setMode("off");
}
