import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ReadonlyCheckoutShippingRequest } from "../../../shipping/domain/ports/readonly-checkout-shipping-supplier.port.js";
import type { WidgetCheckoutProviderShippingRepository, ProviderShippingScope } from "../../domain/ports/widget-checkout-provider-shipping.port.js";
import { providerShippingCommandSchema, providerShippingScopeSchema,
  providerShippingResultSchema, type ProviderShippingEnvelope, type ProviderShippingResult,
} from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";
import { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { beginProviderShipping, completeProviderShipping, unknownProviderShipping } from "../../domain/services/widget-checkout-provider-shipping.js";
import { prepareAcceptedWidgetCheckout } from "./widget-checkout-accepted-reader.js";
import { requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";
import { widgetCheckoutShippingHash, widgetCheckoutRevisionContextHash, widgetCheckoutRevisionEventName, widgetCheckoutRevisionMetadata } from "./widget-cross-sell-checkout-revision.js";

import { readWidgetProviderShippingSources, readWidgetProviderShippingEnvelope, widgetRadiusTariffOptions } from "./widget-checkout-provider-shipping-source.js";

const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 } as const;
type Accepted = Awaited<ReturnType<typeof prepareAcceptedWidgetCheckout>>;
/** RADIUS only, internal and unwired. Each method owns one canonical SQL TX;
 * there is no supplier, geocoder, account refresh, generic save or retry here.
 * Returned begin dispatch exists only after known pending-generation commit. */
export class PrismaWidgetCheckoutProviderShippingRepository implements WidgetCheckoutProviderShippingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(rawScope: ProviderShippingScope, rawCommand: { expectedVersion: number }) {
    const scope = providerShippingScopeSchema.parse(rawScope), command = providerShippingCommandSchema.parse(rawCommand);
    return this.prisma.$transaction(async tx => {
      const current = await prepareAcceptedWidgetCheckout(tx, scope, { lockManualConfig: true });
      if (current.stored.version !== command.expectedVersion) return requireWidgetCrossSellReview();
      const { sources, config } = await readWidgetProviderShippingSources(tx, scope, current);
      const pending = beginProviderShipping(sources, command, { requestId: randomUUID(), now: current.quote.quotedAt },
        await readWidgetProviderShippingEnvelope(tx, scope, current));
      await this.persist(tx, scope, current, pending, "provider_shipping_begin");
      const dispatch: ReadonlyCheckoutShippingRequest = { requestId: pending.requestId, merchantId: scope.merchantId,
        expiresAt: pending.expiresAt, metadataHash: sources.metadataHash, originZip: sources.originZip,
        destinationZip: sources.destinationZip, mode: "radius", config: structuredClone(config) };
      return { pending, dispatch };
    }, transactionOptions);
  }

  async complete(rawScope: ProviderShippingScope, rawRequestId: string, rawResult: ProviderShippingResult) {
    const scope = providerShippingScopeSchema.parse(rawScope), requestId = z.uuidv4().parse(rawRequestId);
    const result = providerShippingResultSchema.parse(rawResult);
    if (result.mode !== "radius") throw new Error("widget_checkout_carrier_account_proof_required");
    return this.prisma.$transaction(async tx => {
      const current = await prepareAcceptedWidgetCheckout(tx, scope, { lockManualConfig: true });
      const { sources, config } = await readWidgetProviderShippingSources(tx, scope, current);
      const pending = await readWidgetProviderShippingEnvelope(tx, scope, current);
      if (!pending || pending.requestId !== requestId) return requireWidgetCrossSellReview();
      const expectedOptions = widgetRadiusTariffOptions(config, result.evidence.distanceKm);
      if (!isDeepStrictEqual(result.options, expectedOptions)) return requireWidgetCrossSellReview();
      const completed = completeProviderShipping(pending, sources, result, current.quote.quotedAt);
      await this.persist(tx, scope, current, completed, "provider_shipping_complete");
      return completed;
    }, transactionOptions);
  }

  async markUnknown(rawScope: ProviderShippingScope, rawRequestId: string) {
    const scope = providerShippingScopeSchema.parse(rawScope), requestId = z.uuidv4().parse(rawRequestId);
    return this.prisma.$transaction(async tx => {
      const current = await prepareAcceptedWidgetCheckout(tx, scope, { lockManualConfig: true });
      const { sources } = await readWidgetProviderShippingSources(tx, scope, current);
      const pending = await readWidgetProviderShippingEnvelope(tx, scope, current);
      if (!pending || pending.requestId !== requestId) return requireWidgetCrossSellReview();
      const unknown = unknownProviderShipping(pending, sources, current.quote.quotedAt);
      await this.persist(tx, scope, current, unknown, "provider_shipping_unknown");
      return unknown;
    }, transactionOptions);
  }

  private async persist(tx: Prisma.TransactionClient, scope: ProviderShippingScope, current: Accepted,
    envelope: ProviderShippingEnvelope, operation: "provider_shipping_begin" | "provider_shipping_complete" | "provider_shipping_unknown") {
    const { stored, cart, receipt, quote } = current;
    if (stored.version >= 2_147_483_647 || stored.strategyContextVersion >= 2_147_483_647
      || envelope.persistenceVersion !== stored.version + 1) return requireWidgetCrossSellReview();
    const next = { ...stored, shipping: null, shippingOptions: envelope };
    const nextReceipt = widgetCrossSellCheckoutReceiptSchema.parse({ ...receipt, revision: {
      eventId: randomUUID(), previousEventId: receipt.revision?.eventId ?? receipt.eventId,
      persistenceVersion: stored.version + 1, revisedAt: quote.quotedAt, contextHash: widgetCheckoutRevisionContextHash(next), operation,
      providerRequestId: envelope.requestId,
      providerSnapshotHash: widgetCheckoutShippingHash(envelope),
    } });
    const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version }, data: {
      shipping: Prisma.DbNull, shippingOptions: envelope as unknown as Prisma.InputJsonValue,
      cart: { ...cart, _widgetCrossSellAcceptance: nextReceipt } as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(quote.quotedAt),
    } });
    if (saved.count !== 1) return requireWidgetCrossSellReview();
    const actual=await tx.checkoutSession.findUnique({where:{merchantId_sessionId:scope}});
    const parsed=z.object({_widgetCrossSellAcceptance:widgetCrossSellCheckoutReceiptSchema}).safeParse(actual?.cart);
    if(!actual||actual.id!==stored.id||actual.merchantId!==scope.merchantId||actual.sessionId!==scope.sessionId
      ||actual.globalUserId!==stored.globalUserId||actual.version!==stored.version+1||actual.strategyContextVersion!==stored.strategyContextVersion
      ||!parsed.success||!isDeepStrictEqual(parsed.data._widgetCrossSellAcceptance,nextReceipt))return requireWidgetCrossSellReview();
    await tx.checkoutEvent.create({ data: { id: nextReceipt.revision!.eventId, ...scope,
      eventName: widgetCheckoutRevisionEventName(nextReceipt), occurredAt: new Date(quote.quotedAt), metadata: widgetCheckoutRevisionMetadata(nextReceipt) } });
  }
}
