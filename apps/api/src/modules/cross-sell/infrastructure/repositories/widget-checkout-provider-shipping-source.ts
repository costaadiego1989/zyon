import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { DEFAULT_QUOTE_TTL_SECONDS } from "@zyon/shipping-engine";
import { checkoutExplicitAddressSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../../shipping/domain/services/manual-delivery-quote.js";
import { getPriceForDistance } from "../../../shipping/domain/services/distance-calculator.service.js";
import type { ProviderShippingScope } from "../../domain/ports/widget-checkout-provider-shipping.port.js";
import { providerShippingSourcesSchema, providerShippingEnvelopeSchema, type ProviderShippingEnvelope } from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";
import { widgetCheckoutManualShippingSnapshotSchema } from "../../domain/contracts/widget-cross-sell-checkout-shipping.schemas.js";
import type { prepareAcceptedWidgetCheckout } from "./widget-checkout-accepted-reader.js";
import { widgetCheckoutShippingHash } from "./widget-cross-sell-checkout-revision.js";
import { requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";

type Accepted = Awaited<ReturnType<typeof prepareAcceptedWidgetCheckout>>;
const originSchema = z.object({ merchantId: z.string().min(1), originZip: z.string().regex(/^\d{8}$/) });
const generationSchema = z.object({ updatedAt: z.date() });
const historyReference = z.string().min(1).max(191), historyHash = z.string().regex(/^[a-f0-9]{64}$/);
const historicalCompletionSchema = z.object({ id: historyReference, merchantId: historyReference, sessionId: historyReference,
  eventName: z.literal("cross_sell_checkout_provider_shipping_completed"), occurredAt: z.date(), metadata: z.strictObject({
    acceptance_event_id: historyReference, previous_revision_event_id: historyReference,
    previous_version: z.number().int().nonnegative(), checkout_version: z.number().int().positive(), context_hash: historyHash,
    operation: z.literal("provider_shipping_complete"), provider_request_id: z.uuidv4(), provider_snapshot_hash: historyHash,
  }) });

/** Source hashes commit real SQL-reader projections, not request fields. Caller
 * already holds merchant/rules/manual-config/session/catalog fences in this TX.
 * Radius does not need measured parcel dimensions, but changes still invalidate
 * the source commitment; unknown dimensions stay null, never fabricated. */
export async function readWidgetProviderShippingSources(tx: Prisma.TransactionClient, scope: ProviderShippingScope, current: Accepted) {
  const address = checkoutExplicitAddressSchema.parse(current.stored.customer?.address);
  if (current.stored.customer?.address_verified !== true) return requireWidgetCrossSellReview();
  const origin = originSchema.parse(await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId },
    select: { merchantId: true, originZip: true } }));
  const rawConfig = await tx.ownDeliveryConfig.findUnique({ where: { merchantId: scope.merchantId } });
  const config = manualDeliveryConfigSchema.parse(rawConfig), generation = generationSchema.parse(rawConfig);
  if (origin.merchantId !== scope.merchantId || config.merchantId !== scope.merchantId || !config.enabled || config.mode !== "radius")
    return requireWidgetCrossSellReview();
  const packages = current.quote.items.map(line => {
    const row = current.rows.find(item => item.id === line.variantId);
    if (!row || row.product.id !== line.productId) return requireWidgetCrossSellReview();
    return { variantId: row.id, productId: row.product.id, sku: row.sku, quantity: line.quantity,
      selectedOptionItemIds: (line.selectedOptions ?? []).map(option => option.itemId).sort(),
      weightGrams: row.weightGrams, heightCm: row.heightCm, widthCm: row.widthCm, lengthCm: row.lengthCm };
  }).sort((a, b) => widgetCheckoutShippingHash(a).localeCompare(widgetCheckoutShippingHash(b)));
  const basisHash = widgetCheckoutShippingHash({ acceptanceEventId: current.receipt.eventId, quote: current.receipt.quote, cart: current.projectedCart });
  const destinationHash = widgetCheckoutShippingHash({ ...scope, buyerId: current.stored.globalUserId, address });
  const originHash = widgetCheckoutShippingHash(origin);
  const configHash = widgetCheckoutShippingHash({ ...config, updatedAt: generation.updatedAt.toISOString() });
  const packageHash = widgetCheckoutShippingHash(packages);
  const metadataHash = widgetCheckoutShippingHash({ version: 1, mode: "radius", ...scope,
    buyerId: current.stored.globalUserId, acceptanceEventId: current.receipt.eventId,
    basisHash, destinationHash, originHash, configHash, packageHash });
  const sources = providerShippingSourcesSchema.parse({ ...scope, buyerId: current.stored.globalUserId,
    acceptanceEventId: current.receipt.eventId, persistenceVersion: current.stored.version,
    originZip: origin.originZip, destinationZip: address.zip, mode: "radius", basisHash, destinationHash,
    originHash, configHash, packageHash, metadataHash });
  return { sources, config, address };
}

export async function readWidgetProviderShippingEnvelope(tx: Prisma.TransactionClient, scope: ProviderShippingScope, current: Accepted): Promise<ProviderShippingEnvelope | undefined> {
  const raw = current.stored.shippingOptions;
  if (raw == null) return undefined;
  if (typeof raw === "object" && Reflect.get(raw, "origin") === "widget_checkout_provider") {
    const envelope = providerShippingEnvelopeSchema.parse(raw), revision = current.receipt.revision;
    if (envelope.state === "completed") {
      // Completed snapshots can survive a legitimate later customer revision.
      // Prove the original scoped completion record, not today's context hash or
      // matching JSON. Fresh current sources still authorize the NEW begin.
      await tx.$queryRaw`SELECT id FROM checkout_events WHERE merchant_id=${scope.merchantId} AND session_id=${scope.sessionId}
        AND event_name='cross_sell_checkout_provider_shipping_completed' AND metadata->>'provider_request_id'=${envelope.requestId}
        ORDER BY id FOR SHARE`;
      const events = z.array(historicalCompletionSchema).length(1).parse(await tx.checkoutEvent.findMany({
        where: { ...scope, eventName: "cross_sell_checkout_provider_shipping_completed", metadata: { path: ["provider_request_id"], equals: envelope.requestId } },
        select: { id: true, merchantId: true, sessionId: true, eventName: true, occurredAt: true, metadata: true }, orderBy: { id: "asc" }, take: 2,
      }));
      const event = events[0]!, metadata = event.metadata;
      if (event.merchantId !== scope.merchantId || event.sessionId !== scope.sessionId
        || metadata.acceptance_event_id !== current.receipt.eventId || metadata.provider_request_id !== envelope.requestId
        || metadata.provider_snapshot_hash !== widgetCheckoutShippingHash(envelope)
        || metadata.checkout_version !== envelope.persistenceVersion || metadata.previous_version !== envelope.persistenceVersion - 1
        || event.occurredAt.getTime() !== Date.parse(envelope.finishedAt) || event.id === metadata.previous_revision_event_id
        || current.stored.version < envelope.persistenceVersion || envelope.persistenceVersion < current.receipt.committedVersion + 2
        || envelope.sources.persistenceVersion !== envelope.persistenceVersion - 1
        || Date.parse(envelope.issuedAt) < Date.parse(current.receipt.acceptedAt)
        || Date.parse(envelope.finishedAt) < Date.parse(envelope.issuedAt) || Date.parse(envelope.finishedAt) > Date.parse(current.quote.quotedAt))
        return requireWidgetCrossSellReview();
      return envelope;
    }
    const operation = envelope.state === "pending" ? "provider_shipping_begin" : "provider_shipping_unknown";
    if (!revision || revision.operation !== operation || revision.providerRequestId !== envelope.requestId
      || revision.providerSnapshotHash !== widgetCheckoutShippingHash(envelope)
      || current.stored.version !== envelope.persistenceVersion || current.stored.shipping != null
      || revision.revisedAt !== (envelope.state === "pending" ? envelope.issuedAt : envelope.finishedAt)
      || Date.parse(envelope.issuedAt) < Date.parse(current.receipt.acceptedAt)
      || envelope.sources.persistenceVersion !== envelope.persistenceVersion - (envelope.state === "pending" ? 0 : 1))
      return requireWidgetCrossSellReview();
    return envelope;
  }
  // A fresh explicit quote may replace a prior manual quote reference, never an
  // unrecognized/invalid provider state. This does not authorize old manual data.
  widgetCheckoutManualShippingSnapshotSchema.parse(raw);
  return undefined;
}


/** Raw configured RADIUS tariff only. Never a measured cost or waived offer. */
export function widgetRadiusTariffOptions(config: z.infer<typeof manualDeliveryConfigSchema>, distanceKm: number) {
  return quoteManualDelivery({ ...config, freeAboveCents: null }, { cartTotalCents: 0,
    radiusPriceCents: getPriceForDistance(distanceKm, config.radiusZones!) })
    .map(({ carrier_key, label, price, eta_days }) => ({ carrier_key, label, price, eta_days }));
}

/** SAME-TX completed-generation selection source, not a detached grant. Current
 * canonical receipt/version and historical completion version are both proved;
 * only then distinguish their technical revision pointers from financial fields. */
export async function readWidgetRadiusShippingSelectionSource(tx: Prisma.TransactionClient,
  scope: ProviderShippingScope, current: Accepted, quoteId: string) {
  const completed = await readWidgetProviderShippingEnvelope(tx, scope, current);
  if (!completed || completed.state !== "completed" || completed.sources.mode !== "radius" || completed.result.mode !== "radius"
    || completed.requestId !== quoteId || completed.result.requestId !== completed.requestId) return requireWidgetCrossSellReview();
  const { sources, config, address } = await readWidgetProviderShippingSources(tx, scope, current);
  const currentVersion = current.stored.version, frozenVersion = completed.sources.persistenceVersion;
  if (!current.receipt.revision || current.receipt.revision.persistenceVersion !== currentVersion
    || sources.persistenceVersion !== currentVersion || completed.persistenceVersion > currentVersion
    || frozenVersion + 1 !== completed.persistenceVersion || frozenVersion < current.receipt.committedVersion + 1)
    return requireWidgetCrossSellReview();
  // Not a generic version bypass: exact current and historical pointers above
  // are independently proved by their real canonical receipt/revision events.
  const { persistenceVersion: _frozenRevision, ...frozenCommercial } = completed.sources;
  const { persistenceVersion: _currentRevision, ...currentCommercial } = sources;
  const now = Date.parse(current.quote.quotedAt);
  if (!isDeepStrictEqual(frozenCommercial, currentCommercial) || Date.parse(completed.issuedAt) > now
    || Date.parse(completed.expiresAt) <= now || Date.parse(completed.result.expiresAt) <= now
    || Date.parse(completed.result.expiresAt) > Date.parse(completed.expiresAt)
    || Date.parse(completed.expiresAt) - Date.parse(completed.issuedAt) !== DEFAULT_QUOTE_TTL_SECONDS * 1000
    || completed.result.evidence.originZip !== sources.originZip || completed.result.evidence.destinationZip !== sources.destinationZip
    || !isDeepStrictEqual(completed.result.options, widgetRadiusTariffOptions(config, completed.result.evidence.distanceKm)))
    return requireWidgetCrossSellReview();
  return { id: completed.requestId, config, address, options: quoteManualDelivery(config, {
    cartTotalCents: current.quote.totalCents, radiusPriceCents: getPriceForDistance(completed.result.evidence.distanceKm, config.radiusZones!),
  }) };
}

