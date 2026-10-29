(async () => {
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  assert.equal(process.env.RAILWAY_ENVIRONMENT_NAME, 'sandbox', 'sandbox_only_probe');
  let externalMutationAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) { externalMutationAttempts++; throw new Error('sandbox_probe_no_external_mutations'); }
    return originalFetch(url, init);
  };
  const load = relative => import(require('node:url').pathToFileURL(require('node:path').resolve('dist', relative)).href);
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await load('app.module.js');
  const { PRISMA_CROSS_MERCHANT_CLIENT } = await load('shared/persistence/persistence.module.js');
  const { CreatePaymentHoldUseCase } = await load('modules/payment/application/payment-hold.use-cases.js');
  const { PaymentHoldLifecycleService } = await load('modules/payment/application/payment-hold-lifecycle.service.js');
  const { ScheduledMerchantSplitService } = await load('modules/payment/application/scheduled-merchant-split.service.js');
  const { PrismaPaymentSettlementLedgerRepository } = await load('modules/payment/infrastructure/prisma-payment-settlement-ledger.repository.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // No init/listen: provider workers and financial schedulers are not started.
  const rootPrisma = app.get(PRISMA_CROSS_MERCHANT_CLIENT);
  const config = await rootPrisma.whatsAppChannelConfig.findFirst({ where: { enabled: true }, select: { merchantId: true } });
  assert.ok(config, 'owned_sandbox_merchant_required');
  const merchantId = config.merchantId, run = randomUUID(), id = `qa_split_${run}`, sessionId = `qa_split_checkout_${run}`;
  const providerPaymentId = `pi_qa_${run.replace(/-/g, '')}`;
  const base = new Date(Date.now() - 3_600_000), due = new Date(base.getTime() + 7 * 86_400_000);
  const capture = { provider: 'stripe', environment: 'test', accountFingerprint: 'synthetic-fixture-account', providerPaymentId,
    amountCents: 599, currency: 'BRL', sourceId: `ch_qa_${run}`, balanceTransactionId: `txn_qa_${run}`, providerFeeCents: 61,
    netAmountCents: 538, availableAt: new Date(base.getTime() + 30 * 86_400_000).toISOString(), fundsAvailable: false };
  const input = { provider: 'stripe', providerAccountFingerprint: capture.accountFingerprint, merchantId, sessionId, intentId: id,
    amountCents: 599, currency: 'BRL', method: 'card', platformFeeCents: 198, settlementMode: 'delayed_merchant_payout',
    merchantPayoutDestination: 'acct_qa_fixture', merchantPayoutHoldDays: 7, merchantPayoutAnchor: 'fulfillment' };
  let providerState = 'pending', simulatedSubmissions = 0;
  const provider = { preflight: async () => {}, readCapture: async () => capture,
    submit: async request => { simulatedSubmissions++; assert.equal(request.amountCents, 340); assert.equal(request.providerPaymentId, providerPaymentId);
      return { state: 'pending', providerTransferId: `tr_qa_${run}` }; },
    reconcile: async () => ({ state: providerState, providerTransferId: `tr_qa_${run}` }) };
  const results = { environment: 'sandbox', deploymentId: process.env.RAILWAY_DEPLOYMENT_ID, synthetic: true,
    realCharges: 0, realTransfers: 0, checks: [], cleanup: {} };
  let holdId, orderId, returnId, prisma;
  const rollbackMarker = `qa_split_rollback_${run}`;
  try {
    await rootPrisma.$transaction(async tx => {
      // Financial ledgers are append-only. Test real PostgreSQL constraints and
      // reads inside one transaction, then roll it back rather than deleting facts.
      prisma = { ...tx, $transaction: callback => callback(tx) };
      try {
    await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: `qa_split_buyer_${run}`, conversationId: sessionId,
      cart: { currency: 'BRL', total: 5, items: [] }, createdAt: base, updatedAt: base } });
    await prisma.paymentIntent.create({ data: { id, merchantId, sessionId, idempotencyKey: id, amountCents: 599,
      approvedAmountCents: 599, currency: 'BRL', method: 'card', status: 'approved', providerPaymentId, creation: { input } } });
    const unit = { id: 'line_1', name: 'Synthetic split validation', variantId: `qa_variant_${run}`, productType: 'service', strategy: 'service',
      quantity: 1, completedQuantity: 0, status: 'in_service', selectedOptions: [] };
    const order = await prisma.completedOrder.create({ data: { merchantId, sessionId, externalOrderId: providerPaymentId,
      orderTotal: 5, currency: 'BRL', completedAt: new Date(base.getTime() - 60_000), fulfillmentJson: { schemaVersion: 1, units: [unit] } } });
    orderId = order.id;
    const ledger = new PrismaPaymentSettlementLedgerRepository(prisma);
    await ledger.appendPlanned({ merchantId, paymentIntentId: id, provider: 'stripe', currency: 'BRL', plannedGrossCents: 599,
      plannedPlatformFeeCents: 198, plannedMerchantNetCents: 401, plannedProviderFeeCents: 0, occurredAt: base,
      entries: [{ entryKey: 'platform_fee', entryType: 'platform_fee', direction: 'credit', recipientType: 'platform', plannedAmountCents: 198 },
        { entryKey: 'merchant_payout', entryType: 'merchant_payout', direction: 'credit', recipientType: 'merchant', recipientReference: merchantId, plannedAmountCents: 401 }] });
    const lifecycle = new PaymentHoldLifecycleService(new CreatePaymentHoldUseCase(prisma), provider);
    await lifecycle.createForApprovedPayment({ id, merchantId, status: 'approved', amountCents: 599, providerPaymentId, creation: { input } });
    const hold = await prisma.paymentHold.findUniqueOrThrow({ where: { paymentIntentId: id } }); holdId = hold.id;
    assert.equal(hold.status, 'awaiting_fulfillment'); assert.equal(hold.holdUntil, null); assert.equal(hold.merchantNetCents, 340);
    results.checks.push('approved_payment_waits_for_fulfillment_and_exact_fees');
    // Limit every scheduler scan and SQL candidate list to this unique fixture.
    const restricted = { ...prisma, paymentHold: { ...prisma.paymentHold,
      findMany: async args => prisma.paymentHold.findMany({ ...args, where: { ...args.where, id: holdId, merchantId } }) },
      $transaction: callback => prisma.$transaction(callback),
      $queryRawUnsafe: (sql, ...params) => sql.includes('SELECT h.id')
        ? prisma.$queryRawUnsafe(sql.replace('ORDER BY o.fulfilled_at', 'AND h.id = $1 AND h.merchant_id = $2 ORDER BY o.fulfilled_at'), holdId, merchantId)
        : prisma.$queryRawUnsafe(sql, ...params) };
    const service = new ScheduledMerchantSplitService(restricted, provider, ledger);
    const readHold = () => prisma.paymentHold.findUniqueOrThrow({ where: { paymentIntentId: id } });
    await service.execute(base); assert.equal((await readHold()).holdUntil, null); assert.equal(simulatedSubmissions, 0);
    results.checks.push('no_date_or_transfer_before_fulfillment');
    await prisma.completedOrder.update({ where: { id: orderId }, data: { fulfilledAt: base,
      fulfillmentJson: { schemaVersion: 1, units: [{ ...unit, completedQuantity: 1, status: 'completed' }] } } });
    await service.execute(base);
    assert.equal((await readHold()).holdUntil.toISOString(), due.toISOString());
    results.checks.push('persisted_schedule_is_fulfillment_plus_exactly_seven_days');
    await service.execute(new Date(due.getTime() - 1)); assert.equal(simulatedSubmissions, 0);
    results.checks.push('no_transfer_one_millisecond_before_due');
    const ret = await prisma.return.create({ data: { merchantId, orderId: providerPaymentId, buyerId: `qa_split_buyer_${run}`,
      reason: 'CHANGED_MIND', imageUrls: [] } }); returnId = ret.id;
    await service.execute(due); assert.equal(simulatedSubmissions, 0);
    results.checks.push('persisted_return_request_blocks_due_split');
    await prisma.return.update({ where: { id: returnId }, data: { status: 'CANCELLED' } });
    results.dueResult = await service.execute(due);
    results.stateAtDue = (await readHold()).status;
    assert.equal(simulatedSubmissions, 1); assert.equal((await readHold()).status, 'payout_submitted');
    await service.execute(new Date(due.getTime() + 60_000)); assert.equal(simulatedSubmissions, 1);
    results.checks.push('one_submission_pending_provider_funds_without_duplicate');
    providerState = 'confirmed';
    await service.execute(new Date(due.getTime() + 120_000)); assert.equal((await readHold()).status, 'released');
    const observations = await ledger.listForPaymentIntent(merchantId, id);
    assert.equal(observations.length, 2);
    const fact = observations[1]; assert.equal(fact.confirmedMerchantNetCents, 340); assert.equal(fact.confirmedProviderFeeCents, 61);
    assert.equal(fact.confirmedGrossCents, fact.confirmedPlatformFeeCents + fact.confirmedMerchantNetCents + fact.confirmedProviderFeeCents);
    results.checks.push('provider_receipt_records_immutable_conserved_allocation');
    await service.execute(new Date(due.getTime() + 180_000)); assert.equal(simulatedSubmissions, 1);
    results.checks.push('released_split_is_never_repeated');
    const carrierIntent = `${id}_carrier`, carrierPayment = `${providerPaymentId}_carrier`, carrierSession = `${sessionId}_carrier`;
    const carrierInput = { ...input, intentId: carrierIntent, sessionId: carrierSession };
    const carrierCapture = { ...capture, providerPaymentId: carrierPayment, sourceId: `${capture.sourceId}_carrier`, balanceTransactionId: `${capture.balanceTransactionId}_carrier` };
    await prisma.checkoutSession.create({ data: { merchantId, sessionId: carrierSession, globalUserId: `qa_split_buyer_${run}`,
      conversationId: carrierSession, cart: { currency: 'BRL', total: 5, items: [] }, createdAt: base, updatedAt: base } });
    await prisma.paymentIntent.create({ data: { id: carrierIntent, merchantId, sessionId: carrierSession, idempotencyKey: carrierIntent,
      amountCents: 599, approvedAmountCents: 599, currency: 'BRL', method: 'card', status: 'approved', providerPaymentId: carrierPayment, creation: { input: carrierInput } } });
    const receivedAt = new Date(base.getTime() - 2 * 86_400_000);
    const shipment = await prisma.shipment.create({ data: { id: `qa_split_shipment_${run}`, merchantId, sessionId: carrierSession,
      externalOrderId: carrierPayment, carrier: 'qa', trackingCode: `QA_SPLIT_${run}`, status: 'delivered',
      createdAt: new Date(receivedAt.getTime() - 86_400_000), updatedAt: base, deliveredAt: receivedAt } });
    await prisma.completedOrder.create({ data: { merchantId, sessionId: carrierSession, externalOrderId: carrierPayment, orderTotal: 5,
      currency: 'BRL', completedAt: new Date(receivedAt.getTime() - 60_000), fulfilledAt: base, fulfillmentJson: { schemaVersion: 1,
        units: [{ ...unit, completedQuantity: 1, productType: 'physical', strategy: 'carrier', status: 'delivered', shipmentId: shipment.id }] } } });
    const carrierProvider = { ...provider, readCapture: async () => carrierCapture };
    await new PaymentHoldLifecycleService(new CreatePaymentHoldUseCase(prisma), carrierProvider).createForApprovedPayment({
      id: carrierIntent, merchantId, status: 'approved', amountCents: 599, providerPaymentId: carrierPayment, creation: { input: carrierInput } });
    holdId = (await prisma.paymentHold.findUniqueOrThrow({ where: { paymentIntentId: carrierIntent } })).id;
    await new ScheduledMerchantSplitService(restricted, carrierProvider, ledger).execute(base);
    const carrierHold = await prisma.paymentHold.findUniqueOrThrow({ where: { paymentIntentId: carrierIntent } });
    assert.equal(carrierHold.fulfilledAt.toISOString(), receivedAt.toISOString());
    assert.equal(carrierHold.holdUntil.toISOString(), new Date(receivedAt.getTime() + 7 * 86_400_000).toISOString());
    results.checks.push('delayed_carrier_webhook_uses_actual_receipt_plus_seven_days');
    results.ok = true;
      } catch (error) { results.ok = false; results.error = { name: error.name, message: error.message, code: error.code,
    stack: String(error.stack).split('\n').slice(0, 4) }; }
      throw new Error(rollbackMarker);
    }, { timeout: 45_000, maxWait: 5_000 });
  } catch (error) {
    if (error.message === rollbackMarker) results.cleanup.transactionRolledBack = true;
    else { results.ok = false; results.error = { name: error.name, message: error.message, code: error.code }; }
  } finally {
    results.externalMutationAttempts = externalMutationAttempts; results.simulatedSubmissions = simulatedSubmissions;
    globalThis.fetch = originalFetch;
    results.cleanup.remainingFixturePayments = await rootPrisma.paymentIntent.count({ where: { id: { startsWith: id }, merchantId } });
    assert.equal(results.cleanup.remainingFixturePayments, 0);
    await rootPrisma.$disconnect(); await app.close();
    console.log('ZYON_SCHEDULED_SPLIT_PROOF=' + JSON.stringify(results)); process.exit(results.ok ? 0 : 1);
  }
})().catch(error => { console.log('ZYON_SPLIT_PROBE_ERROR=' + JSON.stringify({ name: error.name, message: error.message,
  stack: String(error.stack).split('\n').slice(0, 6) })); process.exit(1); });
