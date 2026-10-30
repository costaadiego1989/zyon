import { Injectable, Inject } from "@nestjs/common";
import { negotiateDiscount } from "@zyon/negotiation-engine";
import { evaluateDiscountOffer } from "@zyon/rules-engine";
import type { Cart } from "@zyon/shared-types";
import type { ProductRepositoryPort } from "../../catalog/domain/ports/product-repository.port.js";
import { CartPromoResolutionService } from "../../checkout/application/services/cart-promo-resolution.service.js";
import { QuoteShippingUseCase } from "../../shipping/application/use-cases/quote-shipping.use-case.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import { NEGOTIATION_STORE, type NegotiationStore } from "../../negotiation/domain/ports/negotiation-store.port.js";
import { DEFAULT_MERCHANT_NEGOTIATION_POLICY } from "../../negotiation/domain/negotiation-defaults.js";
import { STOREFRONT_CART_PORT, type StorefrontCartPort } from "../../storefront/domain/ports/storefront-cart.port.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../checkout/domain/checkout-experience.config.js";
import { EmbedTokenService, type EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";
import { StartCheckoutUseCase } from "../../checkout/application/use-cases/start-checkout.use-case.js";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "../../negotiation/application/apply-negotiation-agreement-to-checkout.use-case.js";
import { AcceptCheckoutOfferUseCase } from "../../checkout/application/use-cases/accept-checkout-offer.use-case.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { checkoutCartFingerprint } from "../../negotiation/domain/cart-fingerprint.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { ShoppingError, fingerprint, type TaskConfig, type ShoppingQuote } from "../domain/shopping-agent.js";

export const SHOPPING_COMMERCE = Symbol("ShoppingCommerce");
export interface ShoppingCommerce {
  quote(merchantId: string, config: TaskConfig, now: Date): Promise<ShoppingQuote>;
  prepare(buyerId: string, merchantId: string, activityId: string, config: TaskConfig, quote: ShoppingQuote, origin: string): Promise<{ embedToken: string; cartRef: string }>;
}
@Injectable()
export class ShoppingCommerceService implements ShoppingCommerce {
  constructor(
    @Inject("ProductRepositoryPort") private readonly products: ProductRepositoryPort,
    private readonly cartPromos: CartPromoResolutionService,
    private readonly shipping: QuoteShippingUseCase,
    @Inject(MERCHANT_RULES_REPOSITORY) private readonly rules: MerchantRulesRepository,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(NEGOTIATION_STORE) private readonly negotiations: NegotiationStore,
    @Inject(STOREFRONT_CART_PORT) private readonly carts: StorefrontCartPort,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly fees: CheckoutExperienceConfig,
    private readonly tokens: EmbedTokenService,
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly applyAgreement: ApplyNegotiationAgreementToCheckoutUseCase,
    private readonly acceptOffer: AcceptCheckoutOfferUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly accounts: BuyerAccountRepository,
  ) {}
  async quote(merchantId: string, config: TaskConfig, now: Date): Promise<ShoppingQuote> {
    let available = true;
    const items: Cart["items"] = [];
    for (const choice of config.items) {
      const product = await this.products.findById(merchantId, choice.productId);
      const variant = product?.variants.find(v => v.id === choice.variantId && v.isActive);
      if (!product || !product.isActive || !variant) throw new ShoppingError("agent_product_unavailable", 409);
      if (product.type === "service" || product.type === "food") throw new ShoppingError("agent_product_requires_options", 409);
      available &&= product.hasStock && (product.type === "digital" || variant.stockQuantity - variant.stockReserved >= choice.quantity);
      if (variant.currency !== "BRL") throw new ShoppingError("agent_currency_not_supported");
      items.push({ sku: variant.sku, variantId: variant.id, product_id: product.id, name: product.name, price: variant.basePriceInCents / 100,
        cost: variant.costInCents === undefined ? undefined : variant.costInCents / 100, category: product.categoryId ?? undefined,
        quantity: choice.quantity, productType: product.type === "digital" ? "digital" : "physical", weightGrams: variant.weightGrams,
        length_cm: variant.lengthCm, width_cm: variant.widthCm, height_cm: variant.heightCm });
    }
    const total = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) / 100;
    const cart = await this.cartPromos.resolveCartPromos({ currency: "BRL", total, items }, merchantId, now);
    cart.total = Math.round(cart.items.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0)) / 100;
    const negotiation = await this.negotiate(merchantId, config, cart);
    const discountPercent = negotiation?.agreement ? negotiation.selectedDiscountPercent : 0;
    const discountCents = Math.round(cart.total * discountPercent);
    let shippingCents: number | null = null;
    let shippingLabel: string | undefined;
    let deliveryDays: number | undefined;
    if (config.includeShipping) {
      const physical = cart.items.filter(i => i.productType === "physical");
      if (!physical.length) shippingCents = 0;
      else {
        const preview = await this.shipping.preview({ merchant_id: merchantId, destination_zip: config.destinationZip!, cart_total: cart.total - discountCents / 100,
          items: physical.map(i => ({ sku: i.sku, quantity: i.quantity })),
          packages: physical.map(i => ({ weightKg: (i.weightGrams ?? 0) / 1000, heightCm: i.height_cm ?? 0, widthCm: i.width_cm ?? 0, lengthCm: i.length_cm ?? 0, quantity: i.quantity })) });
        const options = preview.results.filter(r => !config.maxDeliveryDays || r.eta_days <= config.maxDeliveryDays)
          .sort((a, b) => a.price - b.price || a.eta_days - b.eta_days || a.carrier_key.localeCompare(b.carrier_key));
        if (!options.length) throw new ShoppingError("agent_shipping_unavailable", 409);
        shippingCents = options[0]!.price; shippingLabel = options[0]!.label; deliveryDays = options[0]!.eta_days;
      }
    }
    const subtotalCents = Math.round(cart.total * 100);
    const serviceFeeCents = Math.round(this.fees.platformFeeBrl * 100);
    const snapshot = { items: cart.items.map((i, index) => ({ ...config.items[index]!, sku: i.sku, name: i.name, unitPriceCents: Math.round(i.price * 100), ...(i.category ? { categoryId: i.category } : {}) })),
      subtotalCents, discountCents, serviceFeeCents, shippingCents, totalCents: subtotalCents - discountCents + serviceFeeCents + (shippingCents ?? 0),
      currency: "BRL" as const, available, shippingLabel, deliveryDays, discountPercent };
    return { ...snapshot, fingerprint: fingerprint(snapshot), expiresAt: new Date(now.getTime() + 600_000).toISOString() };
  }
  private async negotiate(merchantId: string, config: TaskConfig, cart: Cart) {
    if (!config.targetDiscountPercent && config.kind !== "negotiate") return undefined;
    const policy = await this.negotiations.getMerchantPolicy(merchantId) ?? DEFAULT_MERCHANT_NEGOTIATION_POLICY;
    const result = negotiateDiscount({ merchantId, cart: { total: cart.total, items: cart.items.map(i => ({ sku: i.sku, quantity: i.quantity, price: i.price, categoryId: i.category })) }, merchantPolicy: policy, buyerPreferences: { enabled: true,
      targetDiscountPercent: config.targetDiscountPercent, minimumAcceptableDiscountPercent: config.targetDiscountPercent, maxRounds: 3, autoAccept: false } });
    if (result.agreement) {
      const evaluation = evaluateDiscountOffer(cart, await this.rules.getRules(merchantId), result.selectedDiscountPercent);
      if (!evaluation.approved || evaluation.value !== result.selectedDiscountPercent) return undefined;
    }
    return result;
  }
  async prepare(buyerId: string, merchantId: string, activityId: string, config: TaskConfig, quote: ShoppingQuote, origin: string) {
    const account = await this.accounts.findByGlobalUserId(buyerId);
    const merchant = await this.merchants.getProfile(merchantId);
    if (!account || !merchant) throw new ShoppingError("agent_not_found", 404);
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new ShoppingError("agent_invalid_origin"); }
    if (parsed.origin !== origin || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))) throw new ShoppingError("agent_invalid_origin");
    // This is a separate, explicitly selected purchase; the live conversation cart is preserved.
    const cartRef = `agent_${activityId}`;
    let cart = await this.carts.getOrCreate(merchantId, cartRef);
    if (cart.items.length && cart.items.some(i => !quote.items.some(q => q.variantId === i.variantId && q.quantity === i.quantity))) throw new ShoppingError("agent_checkout_changed", 409);
    for (const item of quote.items) {
      if (cart.items.some(i => i.variantId === item.variantId)) continue;
      cart = await this.carts.addItem(merchantId, cartRef, { variantId: item.variantId, productId: item.productId, name: item.name, sku: item.sku, quantity: item.quantity, unitPriceCents: item.unitPriceCents });
      // Absolute quantities keep concurrent retries from accumulating units.
      cart = await this.carts.updateItemQuantity(merchantId, cartRef, item.variantId, item.quantity);
    }
    const now = Math.floor(Date.now() / 1000);
    const claims: EmbedTokenClaims = { typ: "aacp_embed_v1", merchantId, nonce: `buyer-agent:${activityId}`, issuedAtUnix: now, expiresAtUnix: now + 900,
      allowedOrigin: origin, storefrontCartRef: cartRef, cartRef, aiUserId: `buyer:${buyerId}`,
      scopes: ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create", "payment:intents:confirm", "payment:intents:read"] };
    const session = await this.startCheckout.execute({ merchant_id: merchantId, session_id: embedCheckoutSessionId(claims),
      cart: { currency: "BRL", total: cart.total / 100, items: [] } },
      { storefrontCartRef: cartRef, trustedBuyer: { globalUserId: buyerId, customer: { email: account.email, email_verified: true } }, requireBuyerProof: true });
    if (quote.discountPercent > 0) {
      const cartInput: Cart = { currency: "BRL", total: quote.subtotalCents / 100, items: quote.items.map(i => ({ sku: i.sku, name: i.name, quantity: i.quantity, price: i.unitPriceCents / 100, category: i.categoryId })) };
      const result = await this.negotiate(merchantId, config, cartInput);
      if (!result?.agreement || result.selectedDiscountPercent !== quote.discountPercent) throw new ShoppingError("agent_quote_changed", 409);
      const current = await this.sessions.getSession(merchantId, session.session_id);
      if (!current || current.globalUserId !== buyerId) throw new ShoppingError("agent_checkout_changed", 409);
      const expectedDiscount = quote.discountCents / 100;
      if ((current.cart.currentDiscount ?? 0) < expectedDiscount) {
        const record = await this.negotiations.createNegotiationSessionWithLedger({ merchantId, globalUserId: buyerId, cartFingerprint: checkoutCartFingerprint(cartInput), result });
        const { offer } = await this.applyAgreement.execute({ merchantId, negotiationSessionId: record.id, checkoutSessionId: session.session_id, requestedDiscountPercent: quote.discountPercent, humanConfirmed: true });
        await this.acceptOffer.execute({ merchant_id: merchantId, session_id: session.session_id, offer_id: offer.id });
        // Native storefront orders use the authorized offer directly, with no third-party discount mutation.
        await this.sessions.saveSession({ ...current, cart: { ...current.cart, currentDiscount: expectedDiscount }, updatedAt: new Date().toISOString() });
      }
    }
    return { embedToken: this.tokens.sign(claims), cartRef };
  }
}
