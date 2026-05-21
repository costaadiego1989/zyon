import type { Cart, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import type { HybridCheckoutOptions } from "./merchant-checkout-shell.js";
import { DEFAULT_WIDGET_API_BASE_URL } from "./widget-schemas.js";
import type { ProductSelectionLine } from "./widget-types.js";

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

function parseJsonAttr<T>(raw: string | undefined, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseOptionalJsonAttr<T>(raw: string | undefined): T | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function queryParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function firstQueryValue(params: URLSearchParams | null, names: string[]): string | undefined {
  if (!params) return undefined;
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function productSelectionFromQuery(params: URLSearchParams | null): ProductSelectionLine[] | undefined {
  const productId = firstQueryValue(params, ["productId", "product_id", "sku"]);
  if (!productId) return undefined;
  const quantityRaw = firstQueryValue(params, ["quantity", "qty"]);
  const quantity = quantityRaw ? Number.parseInt(quantityRaw, 10) : 1;
  return [{ sku: productId, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 }];
}

function optionalQueryJson<T>(params: URLSearchParams | null, names: string[]): T | undefined {
  return parseOptionalJsonAttr<T>(firstQueryValue(params, names));
}

export function readMerchantEmbedOptions(el: HTMLElement): HybridCheckoutOptions {
  const ds = el.dataset;
  const params = queryParams();
  const storedEmail =
    typeof window !== "undefined" ? window.localStorage.getItem("aacp_demo_email") ?? undefined : undefined;
  const fallbackCustomer: CustomerHints = {
    email: storedEmail,
    isReturning: true
  };

  return {
    brandTitle: ds.brandTitle?.trim() || "Athom Tech",
    brandSubtitle: ds.brandSubtitle?.trim() || "Checkout inteligente com IA para sua loja",
    merchantId: firstQueryValue(params, ["merchantId", "merchant_id"]) || ds.merchantId?.trim() || "mrc_athom_tech",
    apiBaseUrl: firstQueryValue(params, ["apiBaseUrl", "api_base_url"]) || ds.apiBaseUrl?.trim() || DEFAULT_WIDGET_API_BASE_URL,
    productApiBaseUrl:
      firstQueryValue(params, ["productApiBaseUrl", "product_api_base_url"]) || ds.productApiBaseUrl?.trim() || undefined,
    productSelection: productSelectionFromQuery(params),
    cart: optionalQueryJson<Cart>(params, ["cartJson", "cart_json"]) ?? parseJsonAttr<Cart>(ds.cartJson, DEFAULT_CART),
    customer:
      optionalQueryJson<CustomerHints>(params, ["customerJson", "customer_json"]) ??
      parseJsonAttr<CustomerHints>(ds.customerJson, fallbackCustomer),
    shipping: parseOptionalJsonAttr<ShippingQuote>(ds.shippingJson),
    embedSessionToken: firstQueryValue(params, ["embedToken", "embedSessionToken", "embed_session_token"]) || ds.embedSessionToken?.trim() || undefined
  };
}
