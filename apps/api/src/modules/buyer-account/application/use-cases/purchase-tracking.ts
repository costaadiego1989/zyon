/** Buyer-facing tracking is a projection of persisted fulfillment evidence. */
export interface TrackingProductVariant {
  id: string;
  sku: string;
  productId: string;
  product: { merchantId: string; type: string };
}

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue | undefined => value && typeof value === "object" && !Array.isArray(value)
  ? value as RecordValue : undefined;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const token = (value: unknown) => text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[ -]+/g, "_");
const nonDelivery = (value: unknown) => /^(pickup|pick_up|local_pickup|store_pickup|retirada|retirada_na_loja|digital|digital_delivery|service|no_shipping|none)$/.test(token(value));
const knownType = (value: unknown) => ["physical", "food", "digital", "service"].includes(token(value)) ? token(value) : undefined;
function typeOf(item?: RecordValue) {
  return knownType(item?.productType ?? item?.product_type ?? item?.type ?? item?.product?.type);
}
function notDelivered(value: unknown): boolean {
  const item = record(value);
  return !!item && (item.requiresShipping === false || item.requires_shipping === false ||
    [item.fulfillmentType, item.fulfillment_type, item.deliveryMode, item.delivery_mode, item.method, item.carrier, item.type].some(nonDelivery));
}
function snapshotFor(item: RecordValue, value: unknown): RecordValue | undefined {
  if (!Array.isArray(value)) return undefined;
  const id = text(item.variantId ?? item.variant_id);
  const sku = text(item.sku);
  const candidates = value.map(record).filter((other): other is RecordValue => !!other &&
    (id ? text(other.variantId ?? other.variant_id) === id : !!sku && text(other.sku) === sku));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function classifyTrackingItems(items: unknown, merchantId: string, variants: TrackingProductVariant[],
  completedItems?: unknown, cart?: unknown, shipping?: unknown): unknown[] {
  if (!Array.isArray(items) || notDelivered(shipping)) return [];
  return items.filter((value) => {
    const item = record(value);
    if (!item || notDelivered(item)) return false;
    const completed = snapshotFor(item, completedItems);
    const checkout = snapshotFor(item, record(cart)?.items);
    if (notDelivered(completed) || notDelivered(checkout)) return false;
    // Preserve historical product type when the completed snapshot contains it.
    let type = typeOf(completed) ?? typeOf(item) ?? typeOf(checkout);
    if (!type) {
      const source = { ...checkout, ...completed, ...item };
      const id = text(source.variantId ?? source.variant_id);
      const productId = text(source.productId ?? source.product_id);
      const sku = text(source.sku);
      const matches = variants.filter((variant) => variant.product.merchantId === merchantId &&
        (id ? variant.id === id : productId ? variant.productId === productId && (!sku || variant.sku === sku) : !!sku && variant.sku === sku));
      // SKUs are not globally unique. Ambiguous legacy lines cannot prove type.
      if (matches.length === 1) type = knownType(matches[0].product.type);
    }
    return type === "physical" || type === "food";
  });
}

export function realTrackingCode(value: unknown): string | null {
  const code = text(value);
  return code && !/^pending\s*:/i.test(code) && !/^(pending|undefined|null|none)$/i.test(code)
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
    && !/[\u0000-\u001f\u007f]/.test(code) ? code : null;
}

function publicTrackingUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.(local|localhost)$)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function trackingProjection(trackingItems: unknown[], shipment?: {
  trackingCode: string; trackingUrl?: string | null; carrier?: string | null; status: string;
} | null, orderCode?: string | null, orderStatus?: string | null) {
  const code = realTrackingCode(shipment?.trackingCode) ?? realTrackingCode(orderCode);
  const cancelled = [shipment?.status, orderStatus].some((status) => /^(cancelled|canceled|cancelado)$/.test(token(status)));
  const hasTracking = trackingItems.length > 0 && !!code && !notDelivered(shipment) && !cancelled;
  // Do not attach the state/timeline of a pending placeholder to an older real code.
  const source = realTrackingCode(shipment?.trackingCode) ? shipment : undefined;
  return {
    hasTracking,
    trackingItems: hasTracking ? trackingItems : [],
    trackingCode: hasTracking ? code : null,
    trackingStatus: hasTracking ? source?.status ?? "label_generated" : null,
    trackingUrl: hasTracking ? publicTrackingUrl(source?.trackingUrl) : null,
    carrier: hasTracking && !/^(flat_rate|free_shipping|free)$/.test(token(source?.carrier)) ? text(source?.carrier) || null : null,
  };
}
