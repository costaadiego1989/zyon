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

export interface ActiveOffer {
  type: 'discount_percent' | 'shipping_free' | 'shipping_discount_fixed';
  value: number;
  reason: string;
}

export interface RuleNudge {
  kind: string;
  gap?: number;
  message: string;
  reachable: boolean;
  ruleId?: string;
}

export interface CartState {
  cartId: string | null;
  items: CartItem[];
  itemCount: number;
  discount: number;
  total: number;
  freeShipping?: boolean;
  nextNudge?: RuleNudge;
  activeRules?: Array<{ ruleId?: string; message: string }>;
  activeOffer?: ActiveOffer;
  discountedTotal?: number;
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

  useEffect(() => {
    if (!merchantId) return;
    const savedId = getSavedCartId(merchantId);
    if (!savedId) return;

    setCart((prev) => prev.cartId === savedId ? prev : { ...EMPTY_CART, cartId: savedId });

    cartApi.get(savedId, merchantId)
      .then((data) => {
        if (!data || !data.items?.length) return;
        const baseTotal = data.total;
        let discountedTotal = baseTotal;
        let activeOffer: ActiveOffer | undefined;

        if (data.authorizedOffer) {
          const offer = data.authorizedOffer;
          activeOffer = {
            type: offer.type,
            value: offer.value,
            reason: offer.reason || 'Negociação aplicada',
          };

          if (offer.type === 'discount_percent') {
            discountedTotal = baseTotal * (1 - offer.value / 100);
          } else if (offer.type === 'shipping_free') {
            discountedTotal = baseTotal - (data.shippingTotal ?? 0);
          } else if (offer.type === 'shipping_discount_fixed') {
            discountedTotal = baseTotal - offer.value;
          }
        }

        setCart({
          cartId: data.cartId,
          items: data.items,
          itemCount: data.itemCount,
          discount: data.discount ?? 0,
          total: baseTotal,
          activeOffer,
          discountedTotal,
        });
      })
      .catch(() => { /* silent — cart stays empty until next interaction */ });
  }, [merchantId]);

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && b.data?.items?.length > 0
    );
    if (!cartBlock) return;

    const { items, itemCount, total, discount, cartId, authorizedOffer, shippingTotal, freeShipping, nextNudge, activeRules } = cartBlock.data;

    setCart((prev) => {
      const resolvedCartId = cartId ?? prev.cartId;
      if (resolvedCartId && merchantId) saveCartId(resolvedCartId, merchantId);

      let activeOffer: ActiveOffer | undefined;
      let discountedTotal: number | undefined;

      if (authorizedOffer) {
        const offer = authorizedOffer;
        activeOffer = {
          type: offer.type,
          value: offer.value,
          reason: offer.reason || 'Negociação aplicada',
        };

        if (offer.type === 'discount_percent') {
          discountedTotal = total * (1 - offer.value / 100);
        } else if (offer.type === 'shipping_free') {
          discountedTotal = total - (shippingTotal ?? 0);
        } else if (offer.type === 'shipping_discount_fixed') {
          discountedTotal = total - offer.value;
        }
      }

      return {
        cartId: resolvedCartId,
        items: items.map((i: any) => {
          const qty = i.quantity ?? 1;
          const rawPrice = i.price ?? (i.unit_price_cents ? i.unit_price_cents / 100 : null) ?? i.unitPrice ?? 0;
          const price = rawPrice > 1000 && !i.price ? rawPrice / 100 : rawPrice; 
          return {
            variantId: i.variantId ?? i.variant_id ?? i.id,
            productName: i.productName ?? i.product_name ?? i.name ?? "Produto",
            quantity: qty,
            price,
            subtotal: i.subtotal ? (i.subtotal > 1000 ? i.subtotal / 100 : i.subtotal) : price * qty,
          };
        }),
        itemCount: itemCount ?? items.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0),
        discount: discount ?? 0,
        total: total ? (total > 10000 ? total / 100 : total) : items.reduce((sum: number, i: any) => {
          const p = i.price ?? (i.unit_price_cents ? i.unit_price_cents / 100 : 0);
          return sum + (p > 1000 ? p / 100 : p) * (i.quantity ?? 1);
        }, 0),
        freeShipping: freeShipping ?? false,
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules ?? undefined,
        activeOffer,
        discountedTotal,
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

      let newItems: CartItem[];
      if (quantity <= 0) {
        newItems = prev.items.filter((_, i) => i !== itemIndex);
      } else {
        const item = prev.items[itemIndex];
        newItems = [...prev.items];
        newItems[itemIndex] = { ...item, quantity, subtotal: item.price * quantity };
      }

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
