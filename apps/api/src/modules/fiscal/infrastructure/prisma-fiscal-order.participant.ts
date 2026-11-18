import { supportsFiscalOrderScope } from "../application/fiscal-order-scope.reader.js";
import type { Prisma } from "@prisma/client";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { FiscalEnvironment, FiscalState } from "../domain/fiscal-provider.js";
import { createFiscalReference } from "../domain/fiscal-provider.js";
import type { FiscalOrderCommitInput, FiscalOrderCommitPort, FiscalOrderPolicy } from "../domain/fiscal-order-commit.port.js";
import type { FiscalProfileSupportPort } from "../domain/fiscal-profile.port.js";
import type { FiscalSnapshotRecord } from "../domain/fiscal-sale-snapshot.port.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import { fiscalRecipientFromCustomer } from "../domain/fiscal-checkout.port.js";
import type { PersistedPaymentApproval } from "../../checkout/domain/ports/payment-approval.port.js";
import { FiscalEligibilityService } from "../application/fiscal-eligibility.service.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { FiscalSaleSnapshotService } from "../application/fiscal-sale-snapshot.service.js";
import { PrismaFiscalCheckoutReader } from "./prisma-fiscal-checkout.reader.js";
import { PrismaFiscalProfileRepository } from "./prisma-fiscal-profile.repository.js";
import { PrismaFiscalSnapshotRepository } from "./prisma-fiscal-snapshot.repository.js";
import { PrismaFiscalRepository } from "./prisma-fiscal.repository.js";
import { admitFiscalStock, loadFiscalStockBinding } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { isFiscalOrderScope } from "../domain/fiscal-order-scope.js";

/** Never opens another transaction: the commercial repository supplies its own client. */
export class PrismaFiscalOrderParticipant implements FiscalOrderCommitPort {
  constructor(private readonly tx: Prisma.TransactionClient, private readonly environment: FiscalEnvironment,
    private readonly tenants: TenantContextService, private readonly support: FiscalProfileSupportPort) {
    if ("$transaction" in tx) throw new Error("fiscal_order_transaction_required");
  }
  async record({ order, session, paymentIntentId }: FiscalOrderCommitInput): Promise<FiscalOrderPolicy> {
    const policy: FiscalOrderPolicy = { version: 1, sellers: [] };
    await this.tx.$queryRaw`SELECT id FROM completed_orders WHERE merchant_id = ${order.merchantId}
      AND session_id = ${order.sessionId} AND external_order_id = ${order.externalOrderId} FOR UPDATE`;
    const persisted = await this.tx.completedOrder.findFirstOrThrow({ where: { merchantId: order.merchantId,
      sessionId: order.sessionId, externalOrderId: order.externalOrderId }, include: { fiscalSaleSnapshots: true } });
    const payment = paymentIntentId ? await this.tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: order.merchantId, sessionId: order.sessionId } }) : null;
    const approval = payment as unknown as PersistedPaymentApproval | null;
    if (await this.tx.marketplaceFundingPlan.count({ where: { hostMerchantId: order.merchantId,
      payment: { merchantId: order.merchantId, sessionId: order.sessionId }, ...(payment ? { paymentIntentId: payment.id } : {}) } })) return policy;
    let snapshots: FiscalSnapshotRecord[] = persisted.fiscalSaleSnapshots.filter(snapshot => snapshot.environment === this.environment);
    if (snapshots.some(snapshot => !isFiscalOrderScope(order.merchantId, [snapshot.merchantId, snapshot.orderMerchantId])
      || !isFiscalOrderScope(order.merchantId, readFiscalSnapshotEnvelope(snapshot.items).commercialLines.map(line => line.sellerMerchantId)))) return policy;
    for (const snapshot of snapshots) if (!await supportsFiscalOrderScope(this.tx, snapshot)) return policy;
    if (!snapshots.length) {
      const contexts = await new PrismaFiscalCheckoutReader(this.tx, this.environment, this.tenants).load(session);
      if (!contexts.length) return policy;
      const commercial = order.lineItems ?? [];
      const records = await this.tx.crossStoreLineItem.findMany({ where: { hostMerchantId: order.merchantId,
        checkoutSessionId: { in: [...new Set([session.sessionId, (session.cart as { cart_ref?: string }).cart_ref].filter((value): value is string => !!value))] } } });
      if (!isFiscalOrderScope(order.merchantId, records.map(record => record.sellerMerchantId))) return policy;
      const lines = commercial.map(line => {
        const originalItem = session.cart.items.find(item => item.sku === line.sku && (item.variantId ?? item.sku) === (line.variantId ?? line.sku));
        const record = originalItem?.marketplace ? records.find(record => record.id === originalItem.marketplace!.lineItemId) : undefined;
        return { lineId: line.lineId!, sellerMerchantId: record?.sellerMerchantId ?? order.merchantId, sku: line.sku, name: line.name,
          ...(line.variantId ? { variantId: line.variantId } : {}), productType: line.productType ?? "unknown" as const,
          quantity: line.quantity, unitPriceCents: line.unitPriceCents };
      });
      if (!isFiscalOrderScope(order.merchantId, lines.map(line => line.sellerMerchantId))) return policy;
      for (const context of contexts) if (!context.profile) {
        context.profile = await this.tenants.run({ merchantId: context.merchantId, userId: "fiscal-sale", role: "system" },
          () => new PrismaFiscalProfileRepository(this.tx).createVersion({ merchantId: context.merchantId, environment: this.environment,
            provider: context.connection.provider, operation: "sale", issuerRegime: "unconfigured", itemRules: {}, recipientRequirements: [], sourceContractVersion: "unconfigured" },
          { actorKind: "system", actorId: "fiscal-sale" }));
      }
      const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
      for (const context of contexts) if (context.connection.stockOwner === "provider" && context.connection.erpConnectionId) {
        await this.tenants.run({ merchantId: context.merchantId, userId: "fiscal-stock", role: "system" }, () =>
          admitFiscalStock(this.tx, context.merchantId, context.connection.erpConnectionId!,
            lines.filter(line => line.sellerMerchantId === context.merchantId && !["digital", "service"].includes(line.productType)).map(line => line.sku)));
      }
      const totalCents = Math.round(Number(persisted.orderTotal) * 100), shippingCents = persisted.shippingCents ?? 0;
      const service = new FiscalSaleSnapshotService(new PrismaFiscalSnapshotRepository(this.tx, this.tenants),
        new FiscalProfileService(new PrismaFiscalProfileRepository(this.tx), this.support));
      snapshots = await service.capture({ orderMerchantId: order.merchantId, completedOrderId: persisted.id, orderId: order.externalOrderId,
        completedAt: persisted.completedAt, sessionId: order.sessionId, buyerGlobalUserId: session.globalUserId, currency: persisted.currency,
        buyerContacts: { name: session.customer?.fullName, email: session.customer?.email, phone: session.customer?.phone },
        recipient: fiscalRecipientFromCustomer(session.customer), lines, discountCents: subtotal + shippingCents - totalCents,
        shippingCents, totalCents, paymentProofRef: null }, contexts);
    }
    for (const snapshot of snapshots) {
      const envelope = readFiscalSnapshotEnvelope(snapshot.items);
      policy.sellers.push({ merchantId: snapshot.merchantId, connectionId: envelope.connectionId, ...envelope.policy,
        ...(envelope.erpConnectionId ? { erpConnectionId: envelope.erpConnectionId } : {}),
        skus: [...new Set(envelope.commercialLines.filter(line => !["digital", "service"].includes(line.productType)).map(line => line.sku))] });
      if (!envelope.lines.length && !envelope.pendingLines.length) continue;
      await this.tenants.run({ merchantId: snapshot.merchantId, userId: "fiscal-sale", role: "system" }, async () => {
        const scope = { merchantId: snapshot.merchantId, environment: snapshot.environment };
        const connection = await this.tx.fiscalConnection.findFirstOrThrow({ where: { ...scope, id: envelope.connectionId } });
        const existing = await this.tx.fiscalIntent.findFirst({ where: { ...scope, orderId: order.externalOrderId, operation: "sale" } });
        const eligible = new FiscalEligibilityService().evaluate({ sale: { orderId: persisted.externalOrderId, orderMerchantId: order.merchantId,
          sessionId: order.sessionId, completedAt: persisted.completedAt, currency: persisted.currency, totalCents: Math.round(Number(persisted.orderTotal) * 100),
          cancelledAt: persisted.cancelledAt, transmittedAt: existing?.writeStartedAt ?? null }, connection, approval });
        let state: FiscalState = eligible.state;
        if (state === "queued" && envelope.readinessCode) state = "action_required";
        const repository = new PrismaFiscalRepository(this.tx);
        const intent = await repository.createIntent({ ...scope, orderId: order.externalOrderId, operation: "sale", connectionId: envelope.connectionId,
          profileVersionId: envelope.profileVersionId!, snapshotId: snapshot.id,
          stableReference: createFiscalReference({ ...scope, orderId: order.externalOrderId, operation: "sale" }), state },
        { actorKind: "system", actorId: paymentIntentId ?? "public-completion" });
        if (!existing && (envelope.readinessCode || eligible.code)) await this.tx.fiscalIntent.updateMany({
          where: { ...scope, id: intent.id }, data: { lastErrorCode: envelope.readinessCode ?? eligible.code },
        });
        let enqueue = !existing && state === "queued";
        if (existing?.state === "awaiting_payment" && state !== "awaiting_payment") {
          const updated = await this.tx.fiscalIntent.updateMany({ where: { ...scope, id: intent.id, state: "awaiting_payment" },
            data: { state, lastErrorCode: envelope.readinessCode ?? eligible.code, version: { increment: 1 } } });
          if (updated.count) {
            await this.tx.fiscalEvent.create({ data: { ...scope, intentId: intent.id, actorKind: "system", actorId: paymentIntentId ?? "fiscal-sale",
              action: "payment_eligibility", previousState: "awaiting_payment", nextState: state, safeReasonCode: envelope.readinessCode ?? eligible.code,
              providerEvidenceRef: eligible.paymentProofRef } });
            enqueue = state === "queued";
          }
        }
        if (eligible.paymentProofRef) {
          if (snapshot.paymentProofRef && snapshot.paymentProofRef !== eligible.paymentProofRef) throw new Error("fiscal_payment_proof_conflict");
          await this.tx.fiscalSaleSnapshot.updateMany({ where: { ...scope, id: snapshot.id, paymentProofRef: null }, data: { paymentProofRef: eligible.paymentProofRef } });
        }
        if (["suppressed", "not_eligible_before_activation"].includes(state) && !existing?.writeStartedAt && envelope.erpConnectionId && envelope.policy.stockOwner === "provider") {
          const binding = await loadFiscalStockBinding(this.tx, scope, intent.id);
          const evidenceId = "stock_suppression_" + intent.id;
          await this.tx.fiscalEvent.upsert({ where: { id: evidenceId }, update: {}, create: { id: evidenceId, ...scope, intentId: intent.id,
            actorKind: "system", actorId: "fiscal-sale", action: "stock_effect_suppressed", safeReasonCode: binding.evidenceCode,
            providerEvidenceRef: "completed-order:" + persisted.id } });
          await this.tx.outboxMessage.upsert({ where: { eventId: "fiscal.stock.release_requested:" + intent.id }, update: {}, create: {
            eventId: "fiscal.stock.release_requested:" + intent.id, eventType: "fiscal.stock.release_requested", schemaVersion: 1, merchantId: scope.merchantId,
            occurredAt: new Date(), correlationId: "fiscal:" + intent.id, causationId: paymentIntentId ?? order.externalOrderId, producer: "fiscal",
            payload: { intentId: intent.id, environment: scope.environment, evidenceEventId: evidenceId } } });
        }
        if (enqueue) await this.tx.outboxMessage.upsert({ where: { eventId: "fiscal.intent.queued:" + intent.id }, update: {},
          create: { eventId: "fiscal.intent.queued:" + intent.id, eventType: "fiscal.intent.queued", schemaVersion: 1, merchantId: scope.merchantId,
            occurredAt: new Date(), correlationId: "fiscal:" + intent.id, causationId: paymentIntentId ?? order.externalOrderId, producer: "fiscal",
            payload: { intentId: intent.id, environment: scope.environment } } });
      });
    }
    return policy;
  }
}
