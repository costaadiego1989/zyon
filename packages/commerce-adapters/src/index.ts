import type { AuthorizedOffer } from "@aacp/shared-types";

export * from "./ports.js";
export {
  ShopifyCommerceAdapter,
  type ShopifyCommerceAdapterConfig,
  type ShopifyFetchFn
} from "./shopify/shopify-commerce.adapter.js";
export {
  WooCommerceCommerceAdapter,
  type WooCommerceAdapterConfig,
  type WooCommerceFetchFn,
} from "./woocommerce/woocommerce-commerce.adapter.js";

export interface ShopifyConfig {
  shopDomain?: string;
  adminAccessToken?: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
}

export interface ApplyCommerceOfferResult {
  success: boolean;
  discountCode?: string;
  applyUrl?: string;
  reason?: string;
}

export async function applyShopifyOffer(
  offer: AuthorizedOffer,
  config: ShopifyConfig
): Promise<ApplyCommerceOfferResult> {
  const discountCode = offer.discountCode ?? `AI-${offer.sessionId.slice(0, 6).toUpperCase()}`;
  const shopDomain = config.shopDomain?.replace(/^https?:\/\//, "");

  if (!shopDomain || !config.adminAccessToken) {
    return {
      success: true,
      discountCode,
      applyUrl: shopDomain ? `https://${shopDomain}/discount/${discountCode}` : undefined,
      reason: "shopify_credentials_missing_dev_fallback"
    };
  }

  const apiVersion = config.apiVersion ?? "2026-04";
  const priceRule = await createPriceRule(offer, discountCode, {
    shopDomain,
    adminAccessToken: config.adminAccessToken,
    apiVersion,
    fetchFn: config.fetchFn
  });

  return {
    success: priceRule.success,
    discountCode,
    applyUrl: `https://${shopDomain}/discount/${discountCode}`,
    reason: priceRule.reason
  };
}

async function createPriceRule(
  offer: AuthorizedOffer,
  discountCode: string,
  config: Required<Omit<ShopifyConfig, "fetchFn">> & { fetchFn?: typeof fetch }
): Promise<{ success: boolean; reason?: string }> {
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const valueType = offer.type === "discount_percent" ? "percentage" : "fixed_amount";
  const value = offer.type === "discount_percent" ? `-${offer.value}` : `-${offer.value.toFixed(2)}`;
  const title = `AACP ${discountCode}`;

  try {
    const ruleResponse = await fetchFn(
      `https://${config.shopDomain}/admin/api/${config.apiVersion}/price_rules.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.adminAccessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          price_rule: {
            title,
            target_type: offer.type.startsWith("shipping") ? "shipping_line" : "line_item",
            target_selection: "all",
            allocation_method: "across",
            value_type: valueType,
            value,
            customer_selection: "all",
            starts_at: new Date().toISOString(),
            ends_at: offer.expiresAt,
            usage_limit: 1
          }
        })
      }
    );

    if (!ruleResponse.ok) {
      return { success: false, reason: `shopify_price_rule_failed_${ruleResponse.status}` };
    }

    const ruleJson = (await ruleResponse.json()) as { price_rule?: { id?: number } };
    const priceRuleId = ruleJson.price_rule?.id;
    if (!priceRuleId) return { success: false, reason: "shopify_price_rule_id_missing" };

    const codeResponse = await fetchFn(
      `https://${config.shopDomain}/admin/api/${config.apiVersion}/price_rules/${priceRuleId}/discount_codes.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.adminAccessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ discount_code: { code: discountCode } })
      }
    );

    return codeResponse.ok
      ? { success: true }
      : { success: false, reason: `shopify_discount_code_failed_${codeResponse.status}` };
  } catch {
    return { success: false, reason: "shopify_request_failed" };
  }
}
