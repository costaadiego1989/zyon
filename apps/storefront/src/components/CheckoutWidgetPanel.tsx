"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart-store";
import { CartFAB, CartSheet } from "@zyon/checkout-ui";

interface NativeCartPanelProps {
  onCheckout: () => void;
  onUpdateQty: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
}

export default function NativeCartPanel({
  onCheckout,
  onUpdateQty,
  onRemoveItem,
}: NativeCartPanelProps) {
  const { cart } = useCart();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <CartFAB
        itemCount={cart.itemCount}
        total={cart.total}
        onClick={() => setSheetOpen(true)}
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
        onUpdateQty={onUpdateQty}
        onRemoveItem={onRemoveItem}
      />
    </>
  );
}
