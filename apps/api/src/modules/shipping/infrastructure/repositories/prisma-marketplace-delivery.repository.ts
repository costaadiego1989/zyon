import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { fundingHash, lockMarketplaceOrder } from "../../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { buildMarketplaceFundingBudget, type FrozenMarketplaceFunding } from "../../../marketplace/domain/services/marketplace-funding-budget.js";
import { inventorySaleFingerprint, validateInventorySale } from "../../../inventory/domain/events/inventory-sale.validation.js";
import type { SaleCompletedEvent } from "../../../inventory/domain/events/sale-completed.event.js";
import { assertCarrierQuote, assertMarketplaceShipmentOriginRequests, type MarketplaceShipmentRecord } from "../../domain/marketplace-shipment-journal.js";
import { assertMarketplaceShippingContract, marketplaceShippingContractHash as hash } from "../../domain/marketplace-shipping-contract.js";
import { verifyMarketplaceShipmentRecord } from "../../domain/marketplace-shipment-proof.js";

export type MarketplaceDeliveryResult = { status: "completed" | "already_completed" | "incomplete";
  reason?: "origins_pending" | "non_physical_evidence_required"; physicalLinesUpdated: number; completedOrderId?: string };
type Scope = { hostMerchantId: string; paymentIntentId: string };
type EventProof = { eventId: string; eventType: string; schemaVersion: number; merchantId: string;
  correlationId: string; causationId: string; producer: string; payload: unknown };
const fail = (reason: string): never => { throw new ConflictException(`marketplace_delivery_${reason}`); };
const ascending = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const validId = (id: unknown): id is string => typeof id === "string" && !!id.trim() && id.length <= 200;

/** Delivery is a projection of the immutable marketplace shipment evidence.
 * Event payloads and manual fulfillment never authorize it. No provider call,
 * payout, debt, inventory balance or legacy Shipment is changed here. */
@Injectable()
export class PrismaMarketplaceDeliveryRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async complete(input: Scope): Promise<MarketplaceDeliveryResult> {
    const host = input.hostMerchantId, paymentId = input.paymentIntentId;
    if (!validId(host) || !validId(paymentId)) fail("scope_invalid");
    return this.prisma.$transaction(async tx => {
      // Explicit protected PaymentIntent read also enforces tenant middleware.
      const initial = await tx.paymentIntent.findFirst({ where: { id: paymentId, merchantId: host } });
      if (!initial || initial.merchantId !== host || !initial.providerPaymentId) throw new NotFoundException("marketplace_delivery_order_not_found");
      await lockMarketplaceOrder(tx, host, initial.providerPaymentId);
      const payment = await tx.paymentIntent.findFirst({ where: { id: paymentId, merchantId: host } });
      const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: paymentId, hostMerchantId: host } });
      if (!payment || payment.merchantId !== host || payment.providerPaymentId !== initial.providerPaymentId || !plan) fail("binding_invalid");
      const frozen = plan!.instructions as unknown as FrozenMarketplaceFunding;
      const key = hash([host, paymentId]);
      const existing = await tx.outboxMessage.findUnique({ where: { eventId: `mdelivery_completed_${key}` } });
      const creation = payment!.creation as { input?: { marketplaceFunding?: unknown } } | null;
      if (!frozen || fundingHash(frozen) !== plan!.instructionsHash || fundingHash(creation?.input?.marketplaceFunding ?? null) !== plan!.instructionsHash ||
          frozen.hostMerchantId !== host || frozen.amountCents !== payment!.amountCents || frozen.amountCents !== plan!.amountCents ||
          plan!.providerPaymentId !== payment!.providerPaymentId || payment!.currency !== "BRL" || frozen.currency !== "BRL" ||
          frozen.provider !== plan!.provider || frozen.environment !== plan!.environment || frozen.accountFingerprint !== plan!.accountFingerprint ||
          !Array.isArray(frozen.shipping) ||
          !Array.isArray(frozen.lines) || !frozen.lines.length || frozen.lines.length > 100 ||
          new Set(frozen.lines.map(line => line.lineItemId)).size !== frozen.lines.length) fail("binding_invalid");
      const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: host, orderId: payment!.providerPaymentId! } } });
      if (!ledger?.purchasedAt || ledger.checkoutSessionId !== plan!.checkoutSessionId || !plan!.fundedAt) fail("financial_binding_invalid");
      // An exact persisted certificate records a historical fact, including after a
      // later return/dispute. Mutable gates apply only to a new completion.
      if (!existing && (ledger!.chargebackAt || payment!.status !== "approved" ||
          payment!.approvedAmountCents !== payment!.amountCents || plan!.status !== "funded")) fail("financial_state_blocks_completion");
      const budget = plan!.budget as unknown as ReturnType<typeof buildMarketplaceFundingBudget>;
      if (!budget?.capture || fundingHash(buildMarketplaceFundingBudget(frozen, budget.capture)) !== fundingHash(budget) ||
          budget.capture.providerPaymentId !== payment!.providerPaymentId || budget.capture.provider !== plan!.provider ||
          budget.capture.environment !== plan!.environment || budget.capture.accountFingerprint !== plan!.accountFingerprint ||
          budget.capture.providerFeeCents !== plan!.providerFeeCents || budget.capture.netAmountCents !== plan!.netAmountCents) fail("capture_invalid");

      const aliases = [...new Set([payment!.providerPaymentId!, ...(payment!.commerceOrderId ? [payment!.commerceOrderId] : [])])];
      if (await tx.paymentIntent.count({ where: { merchantId: host, id: { not: paymentId }, OR: [
        { providerPaymentId: { in: aliases } }, { commerceOrderId: { in: aliases } }] } })) fail("order_ambiguous");
      const completed = await tx.completedOrder.findMany({ where: { merchantId: host, externalOrderId: { in: aliases } } });
      if (completed.length > 1 || completed.some(row => row.sessionId !== payment!.sessionId)) fail("order_ambiguous");
      const order = completed[0];
      // Closed requests alone do not erase physical fulfillment. An existing
      // refund journal conserves its hold independently of mutable return status.
      if (!existing && (await tx.return.count({ where: { merchantId: host, orderId: { in: [...aliases, ...completed.map(row => row.id)] },
            OR: [{ status: { notIn: ["REJECTED", "CANCELLED"] } }, { refund: { isNot: null } }] } }) ||
          await tx.marketplaceRefundPlan.count({ where: { hostMerchantId: host, fundingPlanId: paymentId } }))) fail("return_blocks_completion");
      if (order && ((!existing && (order.cancelledAt || !["approved", "paid", "shipped", "delivered"].includes(order.status))) || order.currency !== "BRL" ||
          Math.abs(Number(order.orderTotal) * 100 - (frozen.amountCents - frozen.buyerServiceFeeCents)) > 0.000001 ||
          (order.shippingCents !== null && order.shippingCents !== frozen.shipping.reduce((sum, row) => sum + row.amountCents, 0)))) fail("order_state_invalid");

      const lines = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: host, checkoutSessionId: plan!.checkoutSessionId } });
      const sellerLines = frozen.lines.filter(line => line.sellerMerchantId !== host), own = frozen.hostStockItems ?? [];
      if (lines.length !== sellerLines.length || lines.some(row => !sellerLines.some(line => line.lineItemId === row.id && line.sellerMerchantId === row.sellerMerchantId &&
          line.grossAmountCents === row.unitPriceCents * row.quantity && line.commissionCents === row.commissionCents) ||
          row.orderId !== payment!.providerPaymentId || !row.purchasedAt || !row.sourceVariantId ||
          (!existing && !["pending", "shipped", "delivered"].includes(row.fulfillmentStatus))) ||
          own.length !== frozen.lines.length - sellerLines.length || new Set(own.map(row => row.lineItemId)).size !== own.length ||
          own.some(row => !frozen.lines.some(line => line.sellerMerchantId === host && line.lineItemId === row.lineItemId))) fail("line_identity_invalid");
      const physical = [...lines.filter(row => row.stockReservationId).map(row => ({ lineItemId: row.id, merchantId: row.sellerMerchantId,
        variantId: row.sourceVariantId!, quantity: row.quantity, reservationId: row.stockReservationId })),
      ...own.filter(row => row.requiresStock).map(row => ({ ...row, merchantId: host, reservationId: null }))];
      if (!physical.length) return { status: "incomplete", reason: "non_physical_evidence_required", physicalLinesUpdated: 0 };
      const bindings = frozen.shippingQuotes ?? [];
      const origins = [...new Set(physical.map(row => row.merchantId))].sort(ascending);
      if (bindings.length !== origins.length || new Set(bindings.map(row => row.merchantId)).size !== origins.length ||
          origins.some(origin => !bindings.some(binding => binding.merchantId === origin))) fail("origin_binding_invalid");
      const journals = await tx.marketplaceShipmentJournal.findMany({ where: { hostMerchantId: host, fundingPlanId: paymentId }, orderBy: [{ originMerchantId: "asc" }, { volumeIndex: "asc" }] });
      if (journals.some(row => !origins.includes(row.originMerchantId))) fail("unexpected_origin");
      const allHolds = await tx.stockReservation.findMany({ where: { marketplaceFundingPlanId: paymentId } });
      if (allHolds.length !== physical.length || physical.some(item => allHolds.filter(hold => hold.cartId === item.lineItemId &&
          hold.variantId === item.variantId && hold.quantity === item.quantity && hold.status === "CONFIRMED" && !!hold.stockId &&
          (!item.reservationId || hold.id === item.reservationId)).length !== 1)) fail("stock_proof_invalid");

      const proven: MarketplaceShipmentRecord[] = [];
      const originProofs: Array<{ origin: string; eventId: string; shipmentIds: string[] }> = [];
      const trackingProofs: Array<{ shipmentId: string; requestHash: string; purchaseReceiptHash: string; generationReceiptHash: string }> = [];
      const provenLineIds = new Set<string>();
      const trackingReferences = new Map<string, string | null>();
      for (const origin of origins) {
        const binding = bindings.find(row => row.merchantId === origin)!;
        const quote = await tx.shippingQuote.findFirst({ where: { id: binding.quoteId, merchantId: host } });
        if (!quote || quote.quoteKey !== binding.quoteKey || quote.selectedCarrierKey !== binding.carrierKey || !Array.isArray(quote.results)) fail("quote_binding_invalid");
        const options = (quote!.results as Array<Record<string, unknown>>).filter(row => row.carrier_key === binding.carrierKey);
        const option = options[0];
        if (options.length !== 1 || option.currency !== "BRL" || option.price !== binding.amountCents || !binding.carrierQuoteHash ||
            !/^melhor-envio-[1-9]\d*$/.test(binding.carrierKey) ||
            frozen.shipping.filter(row => row.merchantId === origin && row.amountCents === binding.amountCents).length !== 1) fail("quote_binding_invalid");
        const shipment = assertMarketplaceShippingContract(option.marketplaceShipmentContract, binding.quoteKey, origin);
        if (shipment.destinationZip !== quote!.destinationZip || shipment.products.some(product =>
            frozen.lines.filter(line => line.lineItemId === product.lineItemId && line.sellerMerchantId === origin &&
              line.grossAmountCents === product.unitValueCents * product.quantity).length !== 1)) fail("physical_contract_invalid");
        const carrierQuote = assertCarrierQuote(option.marketplaceCarrierQuote, binding.carrierQuoteHash!, shipment,
          Number(binding.carrierKey.slice("melhor-envio-".length)), binding.amountCents);
        const expected = physical.filter(row => row.merchantId === origin);
        if (shipment.products.length !== expected.length || shipment.products.some(product =>
            expected.filter(row => row.lineItemId === product.lineItemId && row.variantId === product.variantId && row.quantity === product.quantity).length !== 1)) fail("physical_contract_invalid");
        const rows = journals.filter(row => row.originMerchantId === origin).map(verifyMarketplaceShipmentRecord);
        if (!rows.length) continue;
        assertMarketplaceShipmentOriginRequests(rows, { hostMerchantId: host, paymentIntentId: paymentId, originMerchantId: origin, binding, option });
        if (!existing && rows.some(row => row.blockReason || row.cancellationStatus || row.canceledAt || ["canceled", "expired", "undelivered", "suspended"].includes(row.trackingStatus ?? ""))) fail("carrier_state_blocks_completion");
        if (rows.some(row => row.status !== "generated" || row.trackingStatus !== "delivered")) continue;
        if (rows.some(row => !row.purchaseReceipt || !row.purchasedAt || !row.generationReceipt || !row.generatedAt || !row.carrierOrderId || !row.reconciledAt)) fail("carrier_receipt_invalid");
        const originEventId = `mship_origin_delivered_${hash([host, paymentId, origin])}`;
        await this.assertPersistedEvent(tx, { eventId: originEventId, eventType: "marketplace.shipment.origin_delivered", schemaVersion: 1,
          merchantId: host, correlationId: paymentId, causationId: origin, producer: "marketplace-shipping",
          payload: { funding_plan_id: paymentId, origin_merchant_id: origin, volume_count: rows.length, shipment_ids: rows.map(row => row.id) } });
        for (const row of rows) {
          const events = await tx.outboxMessage.findMany({ where: { merchantId: host, correlationId: paymentId, causationId: row.id,
            eventType: "marketplace.shipment.tracking_updated", payload: { path: ["status"], equals: "delivered" } } });
          const matches = events.filter(event => {
            const payload = event.payload as { tracking_code?: unknown };
            return (payload.tracking_code === null || payload.tracking_code === row.trackingCode) &&
              fundingHash(payload) === fundingHash({ origin_merchant_id: origin, carrier_order_id: row.carrierOrderId,
                status: "delivered", tracking_code: payload.tracking_code }) && event.schemaVersion === 1 &&
              event.producer === "marketplace-shipping" && /^mship_evt_[a-f0-9]{64}$/.test(event.eventId);
          });
          if (!matches.length) fail("tracking_proof_invalid");
          // Tracking-code enrichment must not rewrite the historical certificate.
          trackingProofs.push({ shipmentId: row.id, requestHash: row.requestHash,
            purchaseReceiptHash: row.purchaseReceiptHash!, generationReceiptHash: row.generationReceiptHash! });
        }
        // Raw participant read is explicitly bounded to an already verified origin.
        const inventory = await tx.$queryRaw<Array<{ payload: unknown; payload_hash: string }>>`SELECT payload,payload_hash FROM inventory_sale_receipts
          WHERE merchant_id = ${origin} AND order_id = ${payment!.providerPaymentId}`;
        if (inventory.length !== 1) fail("inventory_receipt_missing");
        const sale = validateInventorySale(inventory[0].payload as SaleCompletedEvent);
        if (inventorySaleFingerprint(sale) !== inventory[0].payload_hash || sale.merchantId !== origin || sale.orderId !== payment!.providerPaymentId ||
            sale.totalCents !== frozen.lines.filter(line => line.sellerMerchantId === origin).reduce((sum, line) => sum + line.grossAmountCents, 0) ||
            shipment.products.some(product => sale.items.filter(item => item.variantId === product.variantId && item.sku === product.sku && item.quantity === product.quantity).length !== 1)) fail("inventory_receipt_invalid");
        shipment.products.forEach(product => {
          provenLineIds.add(product.lineItemId);
          const volumes = rows.filter(row => carrierQuote.volumes[row.volumeIndex].products.some(item => item.id === product.lineItemId));
          // fulfillmentReference is displayed as tracking_number by the dashboard.
          // Multiple labels require the shipment view; never expose an event ID here.
          trackingReferences.set(product.lineItemId, volumes.length === 1 ? volumes[0].trackingCode : null);
        });
        proven.push(...rows); originProofs.push({ origin, eventId: originEventId, shipmentIds: rows.map(row => row.id) });
      }
      const allOrigins = originProofs.length === origins.length;
      if (!order && allOrigins) fail("completed_order_missing");
      if (!order) return { status: "incomplete", reason: "origins_pending", physicalLinesUpdated: 0 };
      const completedPayload = { funding_plan_id: paymentId, completed_order_id: order.id, provider_payment_id: payment!.providerPaymentId!,
        origin_merchant_ids: origins, shipment_ids: proven.map(row => row.id), proof_hash: hash({ instructionsHash: plan!.instructionsHash,
          completedOrderId: order.id, origins: originProofs, shipments: trackingProofs }) };
      const completion: EventProof = { eventId: `mdelivery_completed_${key}`, eventType: "marketplace.delivery.completed", schemaVersion: 1,
        merchantId: host, correlationId: paymentId, causationId: order.id, producer: "marketplace-shipping", payload: completedPayload };
      const delivered: EventProof = { ...completion, eventId: `mdelivery_order_${key}`, eventType: "order.delivered",
        payload: { type: "ORDER_DELIVERED", merchantId: host, orderId: order.id, marketplaceFundingPlanId: paymentId } };
      if (existing) {
        if (!allOrigins || provenLineIds.size !== frozen.lines.length) fail("completion_proof_invalid");
        this.assertEvent(existing, completion); await this.assertPersistedEvent(tx, delivered);
        return { status: "already_completed", physicalLinesUpdated: 0, completedOrderId: order.id };
      }
      if (order.status === "delivered" || await tx.outboxMessage.count({ where: { eventId: delivered.eventId } })) fail("unproven_completed_order_state");
      let physicalLinesUpdated = 0;
      for (const line of lines.filter(row => provenLineIds.has(row.id))) {
        const reference = trackingReferences.get(line.id) ?? null;
        if (line.fulfillmentStatus === "delivered" && line.fulfillmentReference === reference) continue;
        const updated = await tx.crossStoreLineItem.updateMany({ where: { id: line.id, hostMerchantId: host,
          orderId: payment!.providerPaymentId, fulfillmentStatus: line.fulfillmentStatus, fulfillmentReference: line.fulfillmentReference },
          data: { fulfillmentStatus: "delivered", fulfillmentReference: reference } });
        if (updated.count !== 1) fail("line_state_changed");
        physicalLinesUpdated += updated.count;
      }
      if (!allOrigins) return { status: "incomplete", reason: "origins_pending", physicalLinesUpdated };
      if (provenLineIds.size !== frozen.lines.length) return { status: "incomplete", reason: "non_physical_evidence_required", physicalLinesUpdated };
      const updated = await tx.completedOrder.updateMany({ where: { id: order.id, merchantId: host, sessionId: payment!.sessionId,
        externalOrderId: order.externalOrderId, status: order.status, cancelledAt: null }, data: { status: "delivered" } });
      if (updated.count !== 1) fail("order_state_changed");
      const occurredAt = new Date();
      for (const event of [completion, delivered]) await tx.outboxMessage.create({ data: { ...event, payload: json(event.payload), occurredAt } });
      return { status: "completed", physicalLinesUpdated, completedOrderId: order.id };
    });
  }

  private assertEvent(actual: EventProof, expected: EventProof) {
    if (["eventId", "eventType", "schemaVersion", "merchantId", "correlationId", "causationId", "producer"].some(key =>
        actual[key as keyof EventProof] !== expected[key as keyof EventProof]) || fundingHash(actual.payload) !== fundingHash(expected.payload)) fail("event_proof_invalid");
  }
  private async assertPersistedEvent(tx: Prisma.TransactionClient, expected: EventProof) {
    const event = await tx.outboxMessage.findUnique({ where: { eventId: expected.eventId } });
    if (!event) fail("event_proof_missing");
    this.assertEvent(event!, expected);
  }
}
