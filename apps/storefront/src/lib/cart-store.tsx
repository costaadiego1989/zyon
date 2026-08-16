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

const STORAGE_KEY = "zyon-storefront-cart";

const EMPTY_CART: CartState = {
  cartId: null,
  items: [],
  itemCount: 0,
  discount: 0,
  total: 0,
};

function loadFromSession(): CartState {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed = JSON.parse(raw) as CartState;
    if (parsed.items?.length > 0) return parsed;
  } catch { /* ignore */ }
  return EMPTY_CART;
}

function saveToSession(cart: CartState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch { /* quota/privacy */ }
}

const CartContext = createContext<CartContextValue>({
  cart: EMPTY_CART,
  updateFromBlocks: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);

  // Restore from sessionStorage on mount
  useEffect(() => {
    const saved = loadFromSession();
    if (saved.items.length > 0) setCart(saved);
  }, []);

  // Persist to sessionStorage on change
  useEffect(() => {
    if (cart.items.length > 0) saveToSession(cart);
  }, [cart]);

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
    );
    if (!cartBlock) return;

    const { items, itemCount, total, discount, cartId } = cartBlock.data;

    const newCart: CartState = {
      cartId: cartId ?? cart.cartId,
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
    };

    setCart(newCart);
  }, [cart.cartId]);

  return (
    <CartContext.Provider value={{ cart, updateFromBlocks }}>
      {children}
    </CartContext.Provider>
  );
}
