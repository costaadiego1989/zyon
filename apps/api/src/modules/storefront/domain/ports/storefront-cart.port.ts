export interface StorefrontCartItem {
  variantId: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl?: string;
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
