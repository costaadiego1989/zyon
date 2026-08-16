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
  loading: boolean;
}

interface CartContextValue {
  cart: CartState;
  updateFromBlocks: (blocks: any[]) => void;
}

const STORAGE_KEY = "zyon-cart-id";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

const EMPTY_CART: CartState = {
  cartId: null,
  items: [],
  itemCount: 0,
  discount: 0,
  total: 0,
  loading: false,
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

export function CartProvider({ children, merchantId }: { children: ReactNode; merchantId?: string }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);

  // On mount: if cartId in sessionStorage, fetch full cart from API
  useEffect(() => {
    const savedId = getSavedCartId();
    if (!savedId || !merchantId) return;

    setCart((prev) => ({ ...prev, cartId: savedId, loading: true }));

    fetch(`${API_BASE}/storefront/conversations/_/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        user_message: "Ver carrinho",
        history: [],
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.blocks) return;
        const cartBlock = data.blocks.find(
          (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
        );
        if (cartBlock) {
          const { items, itemCount, total, discount, cartId } = cartBlock.data;
          setCart({
            cartId: cartId ?? savedId,
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
            loading: false,
          });
        } else {
          setCart((prev) => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        setCart((prev) => ({ ...prev, loading: false }));
      });
  }, [merchantId]);

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
      loading: false,
    });
  }, [cart.cartId]);

  return (
    <CartContext.Provider value={{ cart, updateFromBlocks }}>
      {children}
    </CartContext.Provider>
  );
}
