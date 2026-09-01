export interface StorefrontCartSelectedOption {
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  priceModifierInCents: number;
}

export interface StorefrontCartItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  /** Base variant price plus any selected food-option modifiers, in cents. */
  unitPriceCents: number;
  imageUrl?: string;
  /** Chosen food options (size, add-ons) composing this line, when applicable. */
  selectedOptions?: StorefrontCartSelectedOption[];
}

export interface StorefrontCart {
  id: string;
  merchantId: string;
  sessionId: string;
  items: StorefrontCartItem[];
  couponCode: string | null;
  discount: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

export const STOREFRONT_CART_PORT = Symbol("STOREFRONT_CART_PORT");

export interface StorefrontCartPort {
  getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart>;
  addItem(merchantId: string, sessionId: string, item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }): Promise<StorefrontCart>;
  removeItem(merchantId: string, sessionId: string, variantId: string): Promise<StorefrontCart>;
  updateItemQuantity(merchantId: string, sessionId: string, variantId: string, quantity: number): Promise<StorefrontCart>;
  clear(merchantId: string, sessionId: string): Promise<StorefrontCart>;
  applyCoupon(merchantId: string, sessionId: string, couponCode: string, discountCents: number): Promise<StorefrontCart>;
  removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart>;
}
