export interface StorefrontCartSelectedOption {
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  priceModifierInCents: number;
}

export interface StorefrontCartItem {
  /** Server-owned persisted preconditions; always reauthorized, never price authority. */
  crossSellIntent?: import("../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js").CrossSellAcceptedLineIntent;
  /** Ephemeral server projection; never client price authority. */
  pricingOriginalUnitPriceCents?: number;
  selectedServiceSlot?: import("../../../catalog/domain/services/service-schedule.js").SelectedServiceSlot;
  variantId: string;
  productId: string;
  /** Product category captured from the merchant catalog for rule evaluation. */
  categoryId?: string;
  name: string;
  sku: string;
  quantity: number;
  /** Base variant price plus any selected food-option modifiers, in cents. */
  unitPriceCents: number;
  imageUrl?: string;
  /** Chosen food options (size, add-ons) composing this line, when applicable. */
  selectedOptions?: StorefrontCartSelectedOption[];

marketplace?: { lineItemId: string; sellerMerchantId: string; sellerName?: string; federatedProductId: string };
}

export interface StorefrontCart {
  /** Ephemeral, reconstructed from the original server quote. */
  discountBudget?: import("@zyon/shared-types").Cart["discountBudget"];
  commercialNotices?: import("@zyon/shared-types").CommercialNotice[];
  id: string;
  merchantId: string;
  sessionId: string;
  items: StorefrontCartItem[];
  couponCode: string | null;
  discount: number;
  /** True when a matched advanced rule granted free shipping (rules engine authority). */
  freeShipping: boolean;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

export const STOREFRONT_CART_PORT = Symbol("STOREFRONT_CART_PORT");

/** Exact line selector; absent options are not the explicit empty selection. */
export interface StorefrontCartLineSelector { optionItemIds?: string[]; serviceSlotId?: string | null }

/** Persisted commercial state used for internal compare-and-set, not client authority. */
export type StorefrontCartCommercialSnapshot = Pick<StorefrontCart,
  "items" | "total" | "discount" | "couponCode" | "freeShipping">;

export interface StorefrontCartPort {
  getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart>;
  addItem(merchantId: string, sessionId: string, item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }): Promise<StorefrontCart>;
  removeItem(merchantId: string, sessionId: string, variantId: string, selector?: StorefrontCartLineSelector): Promise<StorefrontCart>;
  updateItemQuantity(merchantId: string, sessionId: string, variantId: string, quantity: number, selector?: StorefrontCartLineSelector): Promise<StorefrontCart>;
  clear(merchantId: string, sessionId: string): Promise<StorefrontCart>;
  applyCoupon(merchantId: string, sessionId: string, couponCode: string, discountCents: number,
    expectedCart?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart>;
  removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart>;
  /**
   * Persist the deterministic cart-rules outcome (discount in cents + free
   * shipping flag). Idempotent: overwrites the prior rule-derived values rather
   * than accumulating. Does not touch couponCode (coupon discount is separate).
   */
  applyRuleOutcome(
    merchantId: string,
    sessionId: string,
    outcome: { discountCents: number; freeShipping: boolean },
    expectedCart?: StorefrontCartCommercialSnapshot,
  ): Promise<StorefrontCart>;
}


