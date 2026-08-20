"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cartApi } from "@/lib/api/api-client";

export interface CartItem {
  variantId: string;
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface CartState {
  cartId: string | null;
  items: CartItem[];
  itemCount: number;
  discount: number;
  total: number;
}

interface CartContextValue {
  cart: CartState;
  updateFromBlocks: (blocks: any[]) => void;
  updateItemQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
}

const STORAGE_KEY_PREFIX = "zyon-cart-id";

function getStorageKey(merchantId: string): string {
  return `${STORAGE_KEY_PREFIX}:${merchantId}`;
}

const EMPTY_CART: CartState = {
  cartId: null,
  items: [],
  itemCount: 0,
  discount: 0,
  total: 0,
};

function getSavedCartId(merchantId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(getStorageKey(merchantId));
  } catch { return null; }
}

function saveCartId(cartId: string, merchantId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getStorageKey(merchantId), cartId);
  } catch { /* quota/privacy */ }
}

const CartContext = createContext<CartContextValue>({
  cart: EMPTY_CART,
  updateFromBlocks: () => {},
  updateItemQuantity: () => {},
  clearCart: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children, merchantId }: { children: ReactNode; merchantId?: string }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);

  // Restore cart from API on mount if cartId exists and merchantId is available
  useEffect(() => {
    if (!merchantId) return;
    const savedId = getSavedCartId(merchantId);
    if (!savedId) return;

    // Hydrate cartId optimistically while fetching full state
    setCart((prev) => prev.cartId === savedId ? prev : { ...EMPTY_CART, cartId: savedId });

    cartApi.get(savedId, merchantId)
      .then((data) => {
        if (!data || !data.items?.length) return;
        setCart({
          cartId: data.cartId,
          items: data.items,
          itemCount: data.itemCount,
          discount: data.discount ?? 0,
          total: data.total,
        });
      })
      .catch(() => { /* silent — cart stays empty until next interaction */ });
  }, [merchantId]);

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
    );
    if (!cartBlock) return;

    const { items, itemCount, total, discount, cartId } = cartBlock.data;

    setCart((prev) => {
      const resolvedCartId = cartId ?? prev.cartId;
      if (resolvedCartId && merchantId) saveCartId(resolvedCartId, merchantId);
      return {
        cartId: resolvedCartId,
        items: items.map((i: any) => {
          const qty = i.quantity ?? 1;
          const price = i.price ?? i.unit_price_cents ?? i.unitPrice ?? 0;
          return {
            variantId: i.variantId ?? i.variant_id ?? i.id,
            productName: i.productName ?? i.product_name ?? i.name ?? "Produto",
            quantity: qty,
            price,
            subtotal: i.subtotal ?? price * qty,
          };
        }),
        itemCount: itemCount ?? items.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0),
        discount: discount ?? 0,
        total: total ?? items.reduce((sum: number, i: any) => sum + (i.subtotal ?? (i.price ?? i.unit_price_cents ?? 0) * (i.quantity ?? 1)), 0),
      };
    });
  }, [merchantId]);

  const clearCart = useCallback(() => {
    setCart(EMPTY_CART);
    if (!merchantId) return;
    try {
      sessionStorage.removeItem(getStorageKey(merchantId));
    } catch { /* quota/privacy */ }
  }, [merchantId]);

  const updateItemQuantity = useCallback((variantId: string, quantity: number) => {
    setCart((prev) => {
      if (!prev.cartId) return prev;
      const itemIndex = prev.items.findIndex((i) => i.variantId === variantId);
      if (itemIndex === -1) return prev;

      const item = prev.items[itemIndex];
      const updatedItem = { ...item, quantity, subtotal: item.price * quantity };
      const newItems = [...prev.items];
      newItems[itemIndex] = updatedItem;

      const newItemCount = newItems.reduce((sum, i) => sum + i.quantity, 0);
      const newTotal = newItems.reduce((sum, i) => sum + i.subtotal, 0);

      return {
        ...prev,
        items: newItems,
        itemCount: newItemCount,
        total: newTotal,
      };
    });
  }, []);

  return (
    <CartContext.Provider value={{ cart, updateFromBlocks, updateItemQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}
