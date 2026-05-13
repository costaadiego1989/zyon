import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import type { HybridCheckoutOptions } from "./merchant-checkout-shell.js";
import { DEFAULT_WIDGET_API_BASE_URL } from "./widget-schemas.js";

const DEFAULT_CART: Cart = {
  currency: "BRL",
  source: "storefront",
  total: 299.9,
  items: [
    {
      sku: "athom-kit-001",
      name: "Kit Smart Home Athom Tech",
      price: 299.9,
      cost: 140,
      quantity: 1,
      imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=640",
      productUrl: "https://athomtech.com.br/kit-smart-home",
      category: "Smart Home",
      variant: "Padrão"
    }
  ]
};

const DEFAULT_SHIPPING: ShippingQuote = {
  customerPrice: 19.9,
  realCost: 22,
  carrier: "Correios",
  method: "PAC",
  deliveryDays: 5,
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
    brandTitle: ds.brandTitle?.trim() || "Athom Tech",
    brandSubtitle: ds.brandSubtitle?.trim() || "Checkout inteligente com IA para sua loja",
    merchantId: ds.merchantId?.trim() || "mrc_athom_tech",
    apiBaseUrl: ds.apiBaseUrl?.trim() || DEFAULT_WIDGET_API_BASE_URL,
    cart: parseJsonAttr<Cart>(ds.cartJson, DEFAULT_CART),
    customer: parseJsonAttr<CustomerHints>(ds.customerJson, fallbackCustomer),
    shipping: parseJsonAttr<ShippingQuote>(ds.shippingJson, DEFAULT_SHIPPING),
    embedSessionToken: ds.embedSessionToken?.trim() || undefined
  };
}
