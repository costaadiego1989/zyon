"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

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
  total: number;
  checkoutUrl: string | null;
  checkoutSessionId: string | null;
}

interface CartContextValue {
  cart: CartState;
  updateFromBlocks: (blocks: any[]) => void;
  setCheckout: (url: string, sessionId: string) => void;
  clearCheckout: () => void;
}

const EMPTY_CART: CartState = {
  cartId: null,
  items: [],
  itemCount: 0,
  total: 0,
  checkoutUrl: null,
  checkoutSessionId: null,
};

const CartContext = createContext<CartContextValue>({
  cart: EMPTY_CART,
  updateFromBlocks: () => {},
  setCheckout: () => {},
  clearCheckout: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const prevCountRef = useRef(0);

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
    );
    if (!cartBlock) return;

    const { items, itemCount, total } = cartBlock.data;
    const cartId = cartBlock.data.cartId ?? cart.cartId;

    prevCountRef.current = cart.itemCount;
    setCart((prev) => ({
      ...prev,
      cartId: cartId ?? prev.cartId,
      items: items.map((i: any) => ({
        variantId: i.variantId,
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
        subtotal: i.subtotal,
      })),
      itemCount: itemCount ?? items.reduce((sum: number, i: any) => sum + i.quantity, 0),
      total,
    }));
  }, [cart.cartId, cart.itemCount]);

  const setCheckout = useCallback((url: string, sessionId: string) => {
    setCart((prev) => ({ ...prev, checkoutUrl: url, checkoutSessionId: sessionId }));
  }, []);

  const clearCheckout = useCallback(() => {
    setCart((prev) => ({ ...prev, checkoutUrl: null, checkoutSessionId: null }));
  }, []);

  return (
    <CartContext.Provider value={{ cart, updateFromBlocks, setCheckout, clearCheckout }}>
      {children}
    </CartContext.Provider>
  );
}
