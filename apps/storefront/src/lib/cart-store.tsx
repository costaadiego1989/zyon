"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

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
}

const STORAGE_KEY = "zyon-cart-id";

const EMPTY_CART: CartState = {
  cartId: null,
  items: [],
  itemCount: 0,
  discount: 0,
  total: 0,
};

function getSavedCartId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch { return null; }
}

function saveCartId(cartId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, cartId);
  } catch { /* quota/privacy */ }
}

const CartContext = createContext<CartContextValue>({
  cart: EMPTY_CART,
  updateFromBlocks: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: ReactNode; merchantId?: string }) {
  const [cart, setCart] = useState<CartState>(() => {
    const savedId = getSavedCartId();
    return savedId ? { ...EMPTY_CART, cartId: savedId } : EMPTY_CART;
  });

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
    );
    if (!cartBlock) return;

    const { items, itemCount, total, discount, cartId } = cartBlock.data;
    const resolvedCartId = cartId ?? cart.cartId;

    if (resolvedCartId) saveCartId(resolvedCartId);

    setCart({
      cartId: resolvedCartId,
      items: items.map((i: any) => ({
        variantId: i.variantId,
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
        subtotal: i.subtotal,
      })),
      itemCount: itemCount ?? items.reduce((sum: number, i: any) => sum + i.quantity, 0),
      discount: discount ?? 0,
      total,
    });
  }, [cart.cartId]);

  return (
    <CartContext.Provider value={{ cart, updateFromBlocks }}>
      {children}
    </CartContext.Provider>
  );
}
