import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import type { HybridCheckoutOptions } from "./merchant-checkout-shell";
import { DEFAULT_WIDGET_API_BASE_URL } from "./widget-schemas";

const DEFAULT_CART: Cart = {
  currency: "BRL",
  source: "storefront",
  total: 899.8,
  items: [
    {
      sku: "bag-001",
      name: "Bolsa Executiva Couro Safiano",
      price: 449.9,
      cost: 210,
      quantity: 2,
      imageUrl: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?w=640",
      productUrl: "https://loja.example.com/bolsa-executiva-couro-safiano",
      category: "Bolsas",
      variant: "Preta"
    }
  ]
};

const DEFAULT_SHIPPING: ShippingQuote = {
  customerPrice: 29.9,
  realCost: 31,
  carrier: "Loggi",
  method: "Express",
  deliveryDays: 2,
  region: "SP"
};

function parseJsonAttr<T>(raw: string | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readMerchantEmbedOptions(el: HTMLElement): HybridCheckoutOptions {
  const ds = el.dataset;
  const storedEmail =
    typeof window !== "undefined" ? window.localStorage.getItem("aacp_demo_email") ?? undefined : undefined;
  const fallbackCustomer: CustomerHints = {
    email: storedEmail,
    isReturning: true
  };

  return {
    brandTitle: ds.brandTitle?.trim() || "Northstar Atelier",
    brandSubtitle: ds.brandSubtitle?.trim() || "Atendimento de compra premium com IA conectada ao checkout",
    merchantId: ds.merchantId?.trim() || "mrc_demo",
    apiBaseUrl: ds.apiBaseUrl?.trim() || DEFAULT_WIDGET_API_BASE_URL,
    cart: parseJsonAttr<Cart>(ds.cartJson, DEFAULT_CART),
    customer: parseJsonAttr<CustomerHints>(ds.customerJson, fallbackCustomer),
    shipping: parseJsonAttr<ShippingQuote>(ds.shippingJson, DEFAULT_SHIPPING),
    embedSessionToken: ds.embedSessionToken?.trim() || undefined
  };
}
