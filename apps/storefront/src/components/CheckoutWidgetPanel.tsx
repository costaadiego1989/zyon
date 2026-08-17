import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { CartFAB, CartSheet } from "@zyon/checkout-ui";
import { useWidgetConfig } from "@/lib/widget-config";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

interface NativeCartPanelProps {
  merchantId?: string;
  onCheckout: () => void | Promise<void>;
  onViewCart: () => void;
  onUpdateQty: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
  forceOpen?: boolean;
}

export default function NativeCartPanel({
  merchantId,
  onCheckout,
  onViewCart,
  onUpdateQty,
  onRemoveItem,
  forceOpen,
}: NativeCartPanelProps) {
  const { cart, clearCart } = useCart();
  const { config: widgetConfig } = useWidgetConfig();
  const [sheetOpen, setSheetOpen] = useState(false);
  const prevCountRef = useRef(cart.itemCount);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBudgetMode = widgetConfig?.budgetModeEnabled === true;

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

  const handleBudgetSubmit = async (data: {
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    note?: string;
  }) => {
    const res = await fetch(`${API_BASE}/storefront/budget-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        customer_name: data.customerName,
        customer_email: data.customerEmail,
        customer_phone: data.customerPhone,
        items: cart.items.map((item) => ({
          variantId: item.variantId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
        })),
        total: cart.total,
        note: data.note,
      }),
    });
    if (!res.ok) throw new Error("budget_request_failed");
    clearCart();
  };

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
        mode={isBudgetMode ? "budget" : "checkout"}
        onClose={() => setSheetOpen(false)}
        onCheckout={() => {
          void (async () => {
            await onCheckout();
            setSheetOpen(false);
          })();
        }}
        onBudgetSubmit={isBudgetMode ? handleBudgetSubmit : undefined}
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
