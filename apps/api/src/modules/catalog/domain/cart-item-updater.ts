import type { CartItem, CheckoutSession } from "@zyon/shared-types";

/**
 * Encapsulates the immutable cart update logic: add a product or increment quantity.
 * (CAT-H5: Extract CartItemUpdater for clarity and testability)
 */
export function addOrUpdateCartItem(
  session: CheckoutSession,
  product: {
    sku: string;
    name: string;
    unit_price: number;
    image_url?: string;
    product_url?: string;
    category?: string;
    variant?: string;
    description?: string;
  },
  quantity: number,
): CheckoutSession {
  const existingItems = session.cart.items;
  const existingIndex = existingItems.findIndex((item) => item.sku === product.sku);

  const updatedItems: CartItem[] =
    existingIndex >= 0
      ? existingItems.map((item, i) =>
          i === existingIndex
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        )
      : [
          ...existingItems,
          {
            sku: product.sku,
            name: product.name,
            price: product.unit_price,
            quantity,
            imageUrl: product.image_url,
            productUrl: product.product_url,
            category: product.category,
            variant: product.variant,
            description: product.description?.slice(0, 100),
          },
        ];

  return {
    ...session,
    cart: {
      ...session.cart,
      items: updatedItems,
      total: roundCartTotal(updatedItems),
    },
    updatedAt: new Date().toISOString(),
  };
}

function roundCartTotal(items: CartItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
}
