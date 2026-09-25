import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemePage } from "../../../../dashboard/src/pages/theme-page";
import { StoreSettingsPage } from "../../../../dashboard/src/pages/store-settings/store-settings-page";
import { ApiContext, useApiInstance } from "../../../../dashboard/src/hooks/useApi";
import NativeCartPanel from "../../../src/components/CheckoutWidgetPanel";
import { CartProvider } from "../../../src/lib/cart-store";
import { WidgetConfigProvider } from "../../../src/components/WidgetConfigProvider";
import { merchantThemeTokens } from "@zyon/shared-types";
import { CheckoutLayout } from "../../../../widget_v2/src/layouts/CheckoutLayout";
import { useCheckoutStore } from "../../../../widget_v2/src/store/checkout-store";
import "../../../../dashboard/src/styles.css";

const merchant = { id: "merchant", name: "Loja de teste", role: "owner", plan: "growth" } as any;
function Fixture() {
  const api = useApiInstance("/api");
  const [theme, setTheme] = useState<any>(null);
  const surface = new URLSearchParams(location.search).get("surface") ?? "theme";
  useEffect(() => {
    void api.getMerchantTheme().then((value) => {
      setTheme(value);
      useCheckoutStore.setState({ status: "active", brand: { ...value, name: merchant.name }, channel: "chat" } as any);
    });
  }, [api]);
  if (!theme) return null;
  return <ApiContext.Provider value={api}>
    {surface === "theme" ? <ThemePage apiBaseUrl="/api" me={merchant} /> : surface === "settings" ? <StoreSettingsPage /> : surface === "checkout" ? <CheckoutLayout /> :
      <main style={{ ...merchantThemeTokens(theme), width: "100%", maxWidth: "var(--aacp-shell-max-width)", height: "100dvh", margin: "0 auto", position: "relative", background: "var(--aacp-bg)", color: "var(--aacp-fg)" } as React.CSSProperties} data-testid="storefront">
        <WidgetConfigProvider merchantId="merchant"><CartProvider merchantId="merchant">
          <NativeCartPanel merchantId="merchant" forceOpen onCheckout={() => { throw new Error("payment_checkout_called"); }} onViewCart={() => {}} onUpdateQty={() => {}} onRemoveItem={() => {}} />
        </CartProvider></WidgetConfigProvider>
      </main>}
  </ApiContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
