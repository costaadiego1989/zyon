import type { Prisma } from "@prisma/client";
import { loadFiscalStockBinding } from "./fiscal-stock-coordination.js";
import type { FiscalTenant } from "../../modules/fiscal/domain/fiscal-repository.port.js";
import type { TenantContextService } from "../tenant/tenant-context.service.js";
export type FiscalCommercialTrigger = { id: string; kind: "cancelled" | "refund" | "partial_refund" };
/** Short SQL participant. It shares the intent lock with stage admission; never performs network IO. */
export async function recordFiscalCommercialChange(tx: Prisma.TransactionClient, scope: FiscalTenant, intentId: string, trigger: FiscalCommercialTrigger, clock = () => new Date()) {
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${intentId} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirst({ where: { ...scope, id: intentId }, include: { document: true, connection: true } }); if (!intent) throw new Error("fiscal_document_not_found");
      const action = "commercial." + trigger.kind;
      if (await tx.fiscalEvent.findFirst({ where: { ...scope, intentId, action, providerEvidenceRef: trigger.id } })) return;
      await tx.fiscalEvent.create({ data: { ...scope, intentId, actorKind: "system", action, providerEvidenceRef: trigger.id, safeReasonCode: "fiscal_commercial_change_requires_review" } });
      const authorized = !!intent.document?.authorizationProtocol;
      const suppressed = !authorized && !intent.writeStartedAt && trigger.kind !== "partial_refund";
      await tx.fiscalIntent.update({ where: { id: intentId }, data: { version: { increment: 1 }, leaseToken: null, leaseUntil: null, leasePurpose: null, state: authorized ? intent.state : suppressed ? "suppressed" : trigger.kind === "partial_refund" ? "action_required" : "reconciliation_required", nextAttemptAt: clock(), lastErrorCode: suppressed ? "fiscal_sale_cancelled_before_transmission" : trigger.kind === "partial_refund" ? "fiscal_partial_refund_requires_review" : intent.lastErrorCode } });
      if (authorized) await tx.fiscalCancellationReview.createMany({ data: { ...scope, documentId: intent.document!.id, triggerId: trigger.id, triggerKind: trigger.kind, ...(trigger.kind === "partial_refund" ? { reviewState: "action_required", safeReasonCode: "fiscal_partial_refund_requires_review" } : {}) }, skipDuplicates: true });
      else if (suppressed) {
        const binding = await loadFiscalStockBinding(tx, scope, intentId);
        const evidence = await tx.fiscalEvent.create({ data: { ...scope, intentId, actorKind: "system", action: "stock_effect_suppressed", safeReasonCode: binding.evidenceCode, providerEvidenceRef: trigger.id } });
        await tx.outboxMessage.create({ data: { eventId: "fiscal.stock.release_requested:" + evidence.id, eventType: "fiscal.stock.release_requested", schemaVersion: 1, merchantId: scope.merchantId, occurredAt: clock(), correlationId: intentId, causationId: evidence.id, producer: "fiscal", payload: { intentId, environment: scope.environment, evidenceEventId: evidence.id } } });
      } else if (intent.writeStartedAt) await tx.outboxMessage.create({ data: { eventId: "fiscal.commercial.reconciliation:" + intentId + ":" + trigger.kind + ":" + trigger.id, eventType: "fiscal.reconciliation.requested", schemaVersion: 1, merchantId: scope.merchantId, occurredAt: clock(), correlationId: intentId, causationId: trigger.id, producer: "fiscal", payload: { intentId, environment: scope.environment, connectionId: intent.connectionId, provider: intent.connection.provider, stableReference: intent.stableReference } } });

}
/** Original commercial ownership is the authority for crossing from host to seller scope. */
export async function recordFiscalOrderChange(tx: Prisma.TransactionClient, input: { merchantId: string; orderId?: string; paymentIntentId?: string; trigger: FiscalCommercialTrigger; sellers?: readonly string[] }, tenants?: TenantContextService) {
  const payment = input.paymentIntentId ? await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: input.merchantId } }) : null;
  if (input.paymentIntentId && !payment) throw new Error("fiscal_refund_payment_missing");
  const aliases = [...new Set([input.orderId, payment?.providerPaymentId, payment?.commerceOrderId].filter((v): v is string => !!v))];
  if (!aliases.length) return;
  const rows = await tx.$queryRaw<Array<{ id: string; merchantId: string; environment: "homologation" | "production" }>>`
    SELECT i.id, i.merchant_id AS "merchantId", i.environment::text AS environment
    FROM fiscal_intents i JOIN fiscal_sale_snapshots s ON s.id = i.snapshot_id
    JOIN completed_orders o ON o.id = s.completed_order_id AND o.merchant_id = s.order_merchant_id
    WHERE o.merchant_id = ${input.merchantId} AND (o.id = ANY(${aliases}) OR o.external_order_id = ANY(${aliases}) OR (s.payment_proof_ref = ${payment?.id ?? ""} AND o.session_id = ${payment?.sessionId ?? ""}))
    ORDER BY i.merchant_id, i.environment, i.id`;
  for (const row of rows) {
    if (input.sellers && !input.sellers.includes(row.merchantId)) continue;
    const run = async () => {
      await recordFiscalCommercialChange(tx, { merchantId: row.merchantId, environment: row.environment }, row.id, input.trigger);
      const eventId = "fiscal.commercial:" + row.id + ":" + input.trigger.id;
      await tx.outboxMessage.upsert({ where: { eventId }, create: { eventId, eventType: "fiscal.commercial.review_requested", schemaVersion: 1,
        merchantId: row.merchantId, occurredAt: new Date(), correlationId: row.id, causationId: input.trigger.id, producer: "commerce",
        payload: { intentId: row.id, environment: row.environment, trigger: input.trigger } }, update: {} });
    };
    await (tenants ? tenants.run({ merchantId: row.merchantId, userId: "fiscal-commercial", role: "system" }, run) : run());
  }
}
/** Confirmed refund amounts come only from the persisted original payment and COMPLETED refund rows. */
export async function recordFiscalReturnRefund(tx: Prisma.TransactionClient, returnId: string, tenants?: TenantContextService) {
  const returned = await tx.return.findUnique({ where: { id: returnId }, include: { refund: true } });
  if (!returned?.refund || returned.refund.status !== "COMPLETED" || !returned.refund.paymentIntentId) return;
  const payment = await tx.paymentIntent.findFirst({ where: { id: returned.refund.paymentIntentId, merchantId: returned.merchantId } });
  if (!payment) throw new Error("fiscal_refund_payment_missing");
  const sum = await tx.returnRefund.aggregate({ where: { paymentIntentId: payment.id, status: "COMPLETED", return: { merchantId: returned.merchantId } }, _sum: { amountInCents: true } });
  await recordFiscalOrderChange(tx, { merchantId: returned.merchantId, orderId: returned.orderId, paymentIntentId: payment.id,
    trigger: { id: "return:" + returned.refund.id, kind: (sum._sum.amountInCents ?? 0) >= payment.amountCents ? "refund" : "partial_refund" } }, tenants);
}
