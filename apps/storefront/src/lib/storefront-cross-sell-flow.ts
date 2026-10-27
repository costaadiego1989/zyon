import { assertCrossSellQuoteScope, assertCrossSellRequestScope, parseCrossSellAcceptance, parseCrossSellQuote,
  parseCrossSellSelection, crossSellOptionIdentity, type CrossSellQuote, type CrossSellSelection } from "./cross-sell-quote";

export type CrossSellBuyerScope = { merchantId: string; cartId: string; conversationId: string };
export type CrossSellDisplayProduct = { id: string; productId?: string; name: string; price: number; priceFormatted: string;
  image?: string; inStock: boolean; discountPercent?: number; promoId?: string; couponCode?: string;
  expectedQuote?: CrossSellQuote; acceptanceStatus?: "ready" | "pending" | "rejected" | "unknown" | "accepted";
  selectedOptionItemIds?: string[];
  readOnlyCandidate?: boolean;
  acceptanceError?: string };
export interface CrossSellBuyerTransport {
  quote(scope: CrossSellBuyerScope, selection: CrossSellSelection): Promise<unknown>;
  accept(scope: CrossSellBuyerScope, expectedQuote: CrossSellQuote): Promise<unknown>;
  getCart(scope: CrossSellBuyerScope): Promise<unknown>;
  applyCart(cart: Record<string, unknown>): void;
}
type Offer = { quote?: CrossSellQuote; preparation?: Promise<void>; attempted: boolean;
  status: NonNullable<CrossSellDisplayProduct["acceptanceStatus"]>; error?: string };
const key = (product: Pick<CrossSellDisplayProduct, "id" | "promoId" | "selectedOptionItemIds">) =>
  JSON.stringify([product.id, product.promoId, [...(product.selectedOptionItemIds ?? [])].sort()]);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const cents = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < .000001 ? Math.round(value * 100) : null;
function productSnapshot(product: CrossSellDisplayProduct): CrossSellDisplayProduct {
  return { id: product.id, ...(product.productId === undefined ? {} : { productId: product.productId }), name: product.name,
    price: product.price, priceFormatted: product.priceFormatted, inStock: product.inStock,
    ...(product.image === undefined ? {} : { image: product.image }),
    ...(product.discountPercent === undefined ? {} : { discountPercent: product.discountPercent }),
    ...(product.promoId === undefined ? {} : { promoId: product.promoId }),
    ...(product.selectedOptionItemIds === undefined ? {} : { selectedOptionItemIds: [...product.selectedOptionItemIds] }),
    ...(product.couponCode === undefined ? {} : { couponCode: product.couponCode }) };
}
/** GET is a separate read after the accepted commit. Never construct a success
 * cart from the prediction or apply a price/quantity that differs from it. */
function matchingCart(value: unknown, expected: CrossSellQuote): Record<string, unknown> {
  if (!record(value) || value.cartId !== expected.cartId || !Array.isArray(value.items)
    || value.items.length !== expected.quote.items.length || value.freeShipping !== false || value.couponCode != null
    || cents(value.subtotal) !== expected.quote.subtotalCents || cents(value.total) !== expected.quote.merchandiseTotalCents
    || cents(value.discount) !== expected.quote.subtotalCents - expected.quote.merchandiseTotalCents) throw new Error("cross_sell_cart_confirmation_mismatch");
  const ids = new Set<string>(); let count = 0;
  for (const line of value.items) {
    if (!record(line) || typeof line.variantId !== "string"
      || typeof line.productName !== "string" || line.productName.length > 1000) throw new Error("cross_sell_cart_confirmation_mismatch");
    const selectedIds = cartOptionIds(line);
    const identity = crossSellOptionIdentity({ variantId: line.variantId, selectedOptionItemIds: selectedIds });
    if (ids.has(identity)) throw new Error("cross_sell_cart_confirmation_mismatch");
    const target = expected.quote.items.find(item => crossSellOptionIdentity(item) === identity);
    if (!target || line.quantity !== target.quantity || cents(line.price) !== target.unitPriceCents
      || cents(line.subtotal) !== target.quantity * target.unitPriceCents) throw new Error("cross_sell_cart_confirmation_mismatch");
    ids.add(identity); count += target.quantity;
  }
  if (value.itemCount !== count) throw new Error("cross_sell_cart_confirmation_mismatch");
  return structuredClone(value);
}

function cartOptionIds(line: Record<string, unknown>): string[] {
  let snapshotIds: string[] | undefined;
  if (line.selectedOptions !== undefined) {
    if (!Array.isArray(line.selectedOptions) || line.selectedOptions.length > 250
      || line.selectedOptions.some(option => !record(option) || typeof option.itemId !== "string")) throw new Error("cross_sell_cart_confirmation_mismatch");
    snapshotIds = line.selectedOptions.map(option => (option as { itemId: string }).itemId);
  }
  const explicit = line.optionItemIds;
  if (explicit !== undefined && (!Array.isArray(explicit) || explicit.length > 250 || explicit.some(id => typeof id !== "string"))) throw new Error("cross_sell_cart_confirmation_mismatch");
  const chosen = (explicit ?? snapshotIds ?? []) as string[];
  if (new Set(chosen).size !== chosen.length || snapshotIds && (new Set(snapshotIds).size !== snapshotIds.length
    || !same([...chosen].sort(), [...snapshotIds].sort()))) throw new Error("cross_sell_cart_confirmation_mismatch");
  return [...chosen].sort();
}

/** Per mounted cart revision. No module/global cache, persistence or financial
 * authority: the server revalidates every expected quote under its cart fence. */
export class StorefrontCrossSellBuyerFlow {
  private readonly offers = new Map<string, Offer>();
  private readonly scope: CrossSellBuyerScope;
  constructor(scope: CrossSellBuyerScope, private readonly transport: CrossSellBuyerTransport,
    private readonly isCurrent: () => boolean, private readonly changed: () => void = () => {}) {
    assertCrossSellRequestScope(scope.merchantId, scope.cartId, scope.conversationId);
    this.scope = Object.freeze({ ...scope });
  }
  private notify() { if (this.isCurrent()) this.changed(); }

  async prepare(products: readonly CrossSellDisplayProduct[]): Promise<void> {
    if (!this.isCurrent()) return;
    const pending: Promise<void>[] = [];
    for (const product of products.slice(0, 40)) {
      if (!product.promoId || product.couponCode || !product.inStock) continue;
      const identity = key(product), existing = this.offers.get(identity);
      if (existing) { if (existing.preparation) pending.push(existing.preparation); continue; }
      const offer: Offer = { attempted: false, status: "ready" };
      this.offers.set(identity, offer);
      let selection: CrossSellSelection;
      try { selection = parseCrossSellSelection({ variantId: product.id, promotionId: product.promoId, quantity: 1,
        ...(product.selectedOptionItemIds === undefined ? {} : { selectedOptionItemIds: product.selectedOptionItemIds }) }); }
      catch { continue; }
      const expectedProductId = product.productId;
      offer.preparation = (async () => {
        try {
          const quote = parseCrossSellQuote(await this.transport.quote(this.scope, selection));
          assertCrossSellQuoteScope(quote, this.scope.merchantId, this.scope.cartId, selection);
          if (!this.isCurrent() || quote.maximumUnitPriceCents >= quote.originalUnitPriceCents
            || expectedProductId !== undefined && expectedProductId !== quote.productId) return;
          offer.quote = quote;
        } catch { /* Unsupported/stale/unknown quote never becomes a promised benefit. No automatic retry. */ }
        finally { this.notify(); }
      })();
      pending.push(offer.preparation);
    }
    await Promise.all(pending);
  }

  present(products: readonly CrossSellDisplayProduct[]): CrossSellDisplayProduct[] {
    if (!this.isCurrent()) return [];
    return products.flatMap(raw => {
      // Existing non-commercial recommendations retain their ordinary path.
      if (!raw.promoId) return raw.couponCode || (raw.discountPercent ?? 0) > 0 ? [] : [productSnapshot(raw)];
      const offer = this.offers.get(key(raw)), quote = offer?.quote;
      if (!offer || !quote || raw.couponCode || raw.productId !== undefined && raw.productId !== quote.productId) return [];
      return [{ ...productSnapshot(raw), productId: quote.productId, price: quote.maximumUnitPriceCents / 100,
        priceFormatted: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(quote.maximumUnitPriceCents / 100),
        discountPercent: (quote.originalUnitPriceCents - quote.maximumUnitPriceCents) * 100 / quote.originalUnitPriceCents,
        expectedQuote: parseCrossSellQuote(quote), acceptanceStatus: offer.status, acceptanceError: offer.error }];
    });
  }

  /** A bound recommendation may be inspected before it can be quoted (required
   * choices). This is read-only, never a discounted or base-price add offer. */
  browse(products: readonly CrossSellDisplayProduct[]): CrossSellDisplayProduct[] {
    if (!this.isCurrent()) return [];
    return products.flatMap(product => {
      const quoted = this.present([product]); if (quoted.length) return quoted;
      if (!product.promoId || !product.productId || product.couponCode || !product.inStock) return [];
      try { parseCrossSellSelection({ variantId: product.id, promotionId: product.promoId, quantity: 1 }); }
      catch { return []; }
      const candidate = productSnapshot(product); delete candidate.discountPercent;
      return [{ ...candidate, price: 0, priceFormatted: "Confira os detalhes", readOnlyCandidate: true }];
    });
  }

  async accept(product: CrossSellDisplayProduct, guard: () => boolean = () => true): Promise<boolean> {
    const offer = this.offers.get(key(product));
    if (!this.isCurrent() || !guard() || !offer?.quote || offer.attempted || product.couponCode || product.readOnlyCandidate) return false;
    let expected: CrossSellQuote;
    try {
      expected = parseCrossSellQuote(product.expectedQuote);
      assertCrossSellQuoteScope(expected, this.scope.merchantId, this.scope.cartId);
      if (product.id !== expected.variantId || product.productId !== expected.productId || product.promoId !== expected.promotionId
        || crossSellOptionIdentity({ variantId: product.id, selectedOptionItemIds: product.selectedOptionItemIds }) !== crossSellOptionIdentity(expected)
        || cents(product.price) !== expected.maximumUnitPriceCents || !same(expected, offer.quote)) return false;
    } catch { return false; }
    // Latch before the first await; failure/unknown is never permission to POST again.
    offer.attempted = true; offer.status = "pending"; this.notify();
    try {
      const acknowledgement = await this.transport.accept(this.scope, expected);
      parseCrossSellAcceptance(acknowledgement, this.scope.merchantId, this.scope.cartId);
      if (!this.isCurrent() || !guard()) return false;
      const cart = matchingCart(await this.transport.getCart(this.scope), expected);
      if (!this.isCurrent() || !guard()) return false;
      this.transport.applyCart(cart);
      offer.status = "accepted"; this.notify(); return true;
    } catch (error) {
      const status = record(error) ? error.status : undefined;
      offer.status = [401, 403, 409, 422].includes(status as number) ? "rejected" : "unknown";
      offer.error = offer.status === "rejected"
        ? "A oferta ou o carrinho mudou. Confira o carrinho antes de continuar."
        : "Não foi possível confirmar o resultado. Confira o carrinho antes de continuar.";
      this.notify(); return false;
    }
  }
}
