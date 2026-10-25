"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cartApi } from "@/lib/api/api-client";
import { ConversationSessionExpiredError } from "@/lib/conversation-access";
import { forgetStorefrontCheckoutToken } from "@/lib/checkout-session-access";
import { parseCommercialNotices, type CommercialNotice } from "@/lib/commercial-notices";
import { readCartLineSelection, type CartLineSelection } from "./cart-line-selection";

export interface CartItem {
  selectionLabel?: string;
  optionItemIds?: string[];
  serviceSlotId?: string | null;
  variantId: string;
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
  /** Public product media returned by the tenant-scoped cart API. */
  image?: string;
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
  couponCode?: string;
  total: number;
  freeShipping?: boolean;
  nextNudge?: RuleNudge;
  activeRules?: Array<{ ruleId?: string; message: string }>;
  commercialNotices?: CommercialNotice[];
  activeOffer?: ActiveOffer;
  discountedTotal?: number;
}

interface CartContextValue {
  cart: CartState;
  /** Set only after a server cart response for this tenant has been received. */
  snapshotMerchantId: string | null;
  updating: boolean;
  error: string | null;
  updateFromBlocks: (blocks: any[]) => void;
  /** Single-use projection of one chat response; independent of transcript scope. */
  captureConversationCartProjection: (scope: { merchantId: string; conversationId: string; cartId?: string | null }) => (blocks: any[]) => boolean;
  updateItemQuantity: (variantId: string, quantity: number, selection?: CartLineSelection) => Promise<void>;
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
  snapshotMerchantId: null,
  updating: false,
  error: null,
  updateFromBlocks: () => {},
  captureConversationCartProjection: () => () => false,
  updateItemQuantity: async () => {},
  clearCart: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

export function CartProvider({ children, merchantId }: { children: ReactNode; merchantId?: string }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const [snapshotMerchantId, setSnapshotMerchantId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updatingRef = useRef<object | null>(null);
  const snapshotVersionRef = useRef(0);
  const activeScopeRef = useRef({ merchantId, cartId: cart.cartId });
  // Invalidate even a merchant A -> B -> A render before effects settle.
  if (activeScopeRef.current.merchantId !== merchantId) snapshotVersionRef.current += 1;
  activeScopeRef.current = { merchantId, cartId: cart.cartId };

  useEffect(() => {
    const snapshotVersion = ++snapshotVersionRef.current;
    updatingRef.current = null;
    setUpdating(false);
    setSnapshotMerchantId(null);
    setError(null);
    if (!merchantId) { setCart(EMPTY_CART); return; }
    const savedId = getSavedCartId(merchantId);
    if (!savedId) { setCart(EMPTY_CART); return; }
    let cancelled = false;

    setCart((prev) => prev.cartId === savedId ? prev : { ...EMPTY_CART, cartId: savedId });

    cartApi.get(savedId, merchantId)
      .then((data) => {
        if (cancelled || snapshotVersionRef.current !== snapshotVersion || !data || !Array.isArray(data.items)) return;
        if (data.cartId !== savedId) throw new Error("invalid_cart_response");
        setError(null);
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
          items: data.items.map((item: any) => ({
            ...readCartLineSelection(item),
            selectionLabel: typeof item.selectionLabel === "string" ? item.selectionLabel : undefined,
            variantId: item.variantId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
            image: item.imageUrl ?? item.image_url ?? item.image,
          })),
          itemCount: data.itemCount,
          discount: data.discount ?? 0,
          couponCode: data.couponCode ?? undefined,
          total: baseTotal,
          freeShipping: data.freeShipping,
          nextNudge: data.nextNudge,
          activeRules: data.activeRules,
          commercialNotices: parseCommercialNotices(data.commercialNotices),
          activeOffer,
          discountedTotal,
        });
        setSnapshotMerchantId(merchantId);
      })
      .catch(() => { if (!cancelled && snapshotVersionRef.current === snapshotVersion) setError("Não foi possível carregar o carrinho. Tente novamente em instantes."); });
    return () => { cancelled = true; };
  }, [merchantId]);

  const updateFromBlocks = useCallback((blocks: any[]) => {
    const cartBlock = blocks?.find(
      (b: any) => b.type === "cart_summary" && Array.isArray(b.data?.items)
    );
    if (!cartBlock) return;
    snapshotVersionRef.current += 1;
    updatingRef.current = null;
    setUpdating(false);
    setError(null);
    setSnapshotMerchantId(merchantId ?? null);

    const { items, itemCount, total, discount, cartId, couponCode, authorizedOffer, shippingTotal, freeShipping, nextNudge, activeRules } = cartBlock.data;
    const commercialNotices = parseCommercialNotices(cartBlock.data.commercialNotices);

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
          // Storefront cart values are BRL. Only explicitly named `_cents`
          // fields are converted; value-based guesses turn legitimate high
          // priced products into amounts 100x smaller.
          const price = i.price ?? (i.unit_price_cents != null ? i.unit_price_cents / 100 : null) ?? i.unitPrice ?? 0;
          return {
            ...readCartLineSelection(i),
            selectionLabel: typeof i.selectionLabel === "string" ? i.selectionLabel : undefined,
            variantId: i.variantId ?? i.variant_id ?? i.id,
            productName: i.productName ?? i.product_name ?? i.name ?? "Produto",
            quantity: qty,
            price,
            subtotal: i.subtotal ?? price * qty,
            image: i.imageUrl ?? i.image_url ?? i.image,
          };
        }),
        itemCount: itemCount ?? items.reduce((sum: number, i: any) => sum + (i.quantity ?? 1), 0),
        discount: discount ?? 0,
        couponCode: couponCode ?? undefined,
        total: total ?? items.reduce((sum: number, i: any) => {
          const p = i.price ?? (i.unit_price_cents != null ? i.unit_price_cents / 100 : i.unitPrice ?? 0);
          return sum + p * (i.quantity ?? 1);
        }, 0),
        freeShipping: freeShipping ?? false,
        nextNudge: nextNudge ?? undefined,
        activeRules: activeRules ?? undefined,
        commercialNotices,
        activeOffer,
        discountedTotal,
      };
    });
  }, [merchantId]);

  const captureConversationCartProjection = useCallback((scope: { merchantId: string; conversationId: string; cartId?: string | null }) => {
    const version = snapshotVersionRef.current;
    const capturedCartId = activeScopeRef.current.cartId;
    const expectedCartId = scope.cartId ?? scope.conversationId;
    let consumed = false;
    return (blocks: any[]): boolean => {
      if (consumed) return false;
      consumed = true;
      if (!merchantId || scope.merchantId !== merchantId || !expectedCartId
        || activeScopeRef.current.merchantId !== merchantId
        || snapshotVersionRef.current !== version
        || activeScopeRef.current.cartId !== capturedCartId
        || (capturedCartId !== null && capturedCartId !== expectedCartId)) return false;
      const summaries = blocks.filter(block => block?.type === "cart_summary");
      if (summaries.length > 1 || summaries.some(block => block.data?.cartId !== expectedCartId || !Array.isArray(block.data?.items))) return false;
      const prepared = blocks.filter(block => block?.type === "checkout_prepared");
      if (prepared.length > 1 || prepared.some(block => block.data?.cartId !== expectedCartId)) return false;
      updateFromBlocks(blocks);
      return true;
    };
  }, [merchantId, updateFromBlocks]);

  const clearCart = useCallback(() => {
    if (merchantId && cart.cartId) forgetStorefrontCheckoutToken({ merchantId, cartRef: cart.cartId });
    snapshotVersionRef.current += 1;
    updatingRef.current = null;
    setUpdating(false);
    setCart(EMPTY_CART);
    setSnapshotMerchantId(null);
    setError(null);
    if (!merchantId) return;
    try {
      sessionStorage.removeItem(getStorageKey(merchantId));
    } catch { /* quota/privacy */ }
  }, [merchantId, cart.cartId]);

  const updateItemQuantity = useCallback(async (variantId: string, quantity: number, selection?: CartLineSelection) => {
    if (updatingRef.current) return;
    if (!merchantId) throw new Error("merchant_id_required");
    const cartId = cart.cartId;
    if (!cartId) throw new Error("cart_id_required");
    const snapshotVersion = snapshotVersionRef.current, command = {};
    const current = () => snapshotVersionRef.current === snapshotVersion
      && activeScopeRef.current.merchantId === merchantId && activeScopeRef.current.cartId === cartId;
    updatingRef.current = command;
    setUpdating(true);
    setError(null);
    try {
      const data = await cartApi.updateItem(cartId, variantId, quantity, merchantId, selection);
      if (!current()) return;
      if (!data || data.cartId !== cartId || !Array.isArray(data.items)) {
        throw new Error("invalid_cart_response");
      }
      updateFromBlocks([{ type: "cart_summary", data }]);
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof ConversationSessionExpiredError
        ? "Sua conversa e seus itens foram preservados. A sessão precisa ser validada antes de atualizar o carrinho; sua solicitação não foi reenviada automaticamente."
        : "Não foi possível atualizar o carrinho. Seus itens foram mantidos; tente novamente.");
    } finally {
      // A replaced snapshot may already own a new request. An old completion
      // must not release that request's singleflight or clear its busy state.
      if (updatingRef.current === command) {
        updatingRef.current = null;
        setUpdating(false);
      }
    }
  }, [cart.cartId, merchantId, updateFromBlocks]);

  return (
    <CartContext.Provider value={{ cart: snapshotMerchantId === merchantId ? cart : EMPTY_CART, snapshotMerchantId: snapshotMerchantId === merchantId ? snapshotMerchantId : null,
      updating, error, updateFromBlocks, captureConversationCartProjection, updateItemQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}
