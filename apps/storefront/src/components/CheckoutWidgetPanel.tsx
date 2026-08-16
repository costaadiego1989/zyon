"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { CartFAB, CartSheet } from "@zyon/checkout-ui";

interface NativeCartPanelProps {
  onCheckout: () => void;
  onViewCart: () => void;
  onUpdateQty: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
  forceOpen?: boolean;
}

export default function NativeCartPanel({
  onCheckout,
  onViewCart,
  onUpdateQty,
  onRemoveItem,
  forceOpen,
}: NativeCartPanelProps) {
  const { cart } = useCart();
  const [sheetOpen, setSheetOpen] = useState(false);
  const prevCountRef = useRef(cart.itemCount);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Force open from parent (e.g., "Ver carrinho" quickReply)
  useEffect(() => {
    if (forceOpen) {
      handleManualOpen();
    }
  }, [forceOpen]);

  // Auto-open drawer when items are added, auto-close after 3s
  useEffect(() => {
    if (cart.itemCount > prevCountRef.current && cart.itemCount > 0) {
      setSheetOpen(true);

      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = setTimeout(() => {
        setSheetOpen(false);
        autoCloseTimerRef.current = null;
      }, 3000);
    }
    prevCountRef.current = cart.itemCount;
  }, [cart.itemCount]);

  // Cancel auto-close on user interaction (manual open)
  const handleManualOpen = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setSheetOpen(true);
  };

  // Persist cart to sessionStorage
  useEffect(() => {
    if (cart.items.length > 0) {
      try {
        sessionStorage.setItem("zyon-cart", JSON.stringify(cart));
      } catch { /* quota/privacy */ }
    }
  }, [cart]);

  return (
    <>
      <CartFAB
        itemCount={cart.itemCount}
        total={cart.total}
        onClick={handleManualOpen}
      />
      <CartSheet
        open={sheetOpen}
        cart={{
          cartId: cart.cartId,
          items: cart.items,
          itemCount: cart.itemCount,
          subtotal: cart.total + (cart.discount ?? 0),
          discount: cart.discount ?? 0,
          total: cart.total,
        }}
        onClose={() => setSheetOpen(false)}
        onCheckout={() => {
          setSheetOpen(false);
          onCheckout();
        }}
        onViewCart={() => {
          setSheetOpen(false);
          onViewCart();
        }}
        onUpdateQty={onUpdateQty}
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
