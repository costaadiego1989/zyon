import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart-store";
import { CartFAB, CartSheet } from "@zyon/checkout-ui";
import { useWidgetConfig } from "@/lib/widget-config";
import { cartApi } from "@/lib/api/api-client";

interface NativeCartPanelProps {
  merchantId?: string;
  budgetModeEnabled?: boolean;
  onCheckout: () => void | Promise<void>;
  onViewCart: () => void;
  onUpdateQty: (variantId: string, quantity: number) => void;
  onRemoveItem: (variantId: string) => void;
  forceOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  suppressAutoOpen?: boolean;
}
export default function NativeCartPanel({
  merchantId,
  budgetModeEnabled = false,
  onCheckout,
  onViewCart,
  onUpdateQty,
  onRemoveItem,
  forceOpen,
  onOpen,
  onClose,
  suppressAutoOpen,
}: NativeCartPanelProps) {
  const { cart, clearCart, updating, error } = useCart();
  const { config: widgetConfig, error: configError } = useWidgetConfig();
  const [sheetOpen, setSheetOpen] = useState(false);
  const fabButtonRef = useRef<HTMLButtonElement>(null);
  const returnToFabRef = useRef(false);
  const prevCountRef = useRef(cart.itemCount);
  const manuallyOpenedRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBudgetMode = widgetConfig?.budgetModeEnabled ?? budgetModeEnabled;

  useEffect(() => {
    if (!sheetOpen) returnToFabRef.current = false;
  }, [sheetOpen]);
  
  useEffect(() => {
    if (forceOpen) {
      manuallyOpenedRef.current = true;
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      setSheetOpen(true);
    } else {
      manuallyOpenedRef.current = false;
      setSheetOpen(false);
    }
  }, [forceOpen]);
  
  useEffect(() => {
    if (!manuallyOpenedRef.current && !suppressAutoOpen && cart.itemCount > prevCountRef.current && cart.itemCount > 0) {
      setSheetOpen(true);
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = setTimeout(() => {
        setSheetOpen(false);
        autoCloseTimerRef.current = null;
      }, 3000);
    }
    prevCountRef.current = cart.itemCount;
  }, [cart.itemCount, suppressAutoOpen]);
  
  const handleManualOpen = () => {
    manuallyOpenedRef.current = true;
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setSheetOpen(true);
    onOpen?.();
  };
  const closeSheet = () => { manuallyOpenedRef.current = false; setSheetOpen(false); onClose?.(); };
  useEffect(() => () => { if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current); }, []);
  
  useEffect(() => {
    if (cart.items.length > 0) {
      try {
        sessionStorage.setItem("zyon-cart", JSON.stringify(cart));
      } catch {  }
    }
  }, [cart]);
  const handleBudgetSubmit = async (data: {
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    note?: string;
  }) => {
    if (!merchantId || !cart.cartId) throw new Error("Não foi possível identificar seu carrinho. Reabra a loja e tente novamente.");
    const result = await cartApi.requestBudget(cart.cartId, merchantId, data);
    if (!result.id) throw new Error("A solicitação não foi confirmada. Tente novamente.");
    clearCart();
  };
  return (
    <>
      {!sheetOpen && <CartFAB
        buttonRef={fabButtonRef}
        itemCount={cart.itemCount}
        total={cart.total}
        onClick={() => { returnToFabRef.current = true; handleManualOpen(); }}
      />}
      <CartSheet
        returnFocus={() => returnToFabRef.current ? fabButtonRef.current : null}
        open={sheetOpen}
        cart={{
          cartId: cart.cartId,
          items: cart.items.map((item) => ({
            ...item,
            image: item.image,
          })),
          itemCount: cart.itemCount,
          subtotal: cart.total + (cart.discount ?? 0),
          discount: cart.discount ?? 0,
          total: cart.total,
        }}
        mode={isBudgetMode ? "budget" : "checkout"}
        updating={updating || widgetConfig == null}
        error={error ?? (configError ? "Não foi possível carregar as configurações da loja. Recarregue a página para tentar novamente." : null)}
        onClose={closeSheet}
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
        onUpdateQty={(id, quantity) => { handleManualOpen(); onUpdateQty(id, quantity); }}
        onRemoveItem={(id) => { handleManualOpen(); onRemoveItem(id); }}
      />
    </>
  );
}
