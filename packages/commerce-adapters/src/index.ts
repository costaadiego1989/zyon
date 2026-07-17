import type { AuthorizedOffer } from "@zyon/shared-types";

export * from "./ports.js";
export {
  ShopifyCommerceAdapter,
  ShopifyRateLimitError,
  type ShopifyCommerceAdapterConfig,
  type ShopifyFetchFn
} from "./shopify/shopify-commerce.adapter.js";
export {
  ShopifyRateLimiter,
  parseRetryAfterSeconds,
  retryDelayFromHeaders,
  type ShopifyGraphqlCost,
  type ShopifyGraphqlEnvelope,
  type ShopifyThrottleStatus
} from "./shopify/shopify-rate-limiter.js";
export {
  WooCommerceCommerceAdapter,
  type WooCommerceAdapterConfig,
  type WooCommerceFetchFn,
} from "./woocommerce/woocommerce-commerce.adapter.js";
export {
  NuvemshopCommerceAdapter,
  type NuvemshopAdapterConfig,
  type NuvemshopFetchFn,
} from "./nuvemshop/nuvemshop-commerce.adapter.js";
export { NuvemshopRateLimiter } from "./nuvemshop/nuvemshop-rate-limiter.js";
export {
  TrayCommerceAdapter,
  type TrayCommerceCredentials,
  type TrayFetchFn,
} from "./tray/tray-commerce.adapter.js";

export interface ShopifyConfig {
  shopDomain?: string;
  adminAccessToken?: string;
  apiVersion?: string;
  fetchFn?: typeof fetch;
  /** When true (default) uses GraphQL discountCodeBasicCreate; false uses legacy REST price rules. */
  useGraphqlAdminApi?: boolean;
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
    fetchFn: config.fetchFn,
    useGraphqlAdminApi: config.useGraphqlAdminApi
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
  config: Required<Omit<ShopifyConfig, "fetchFn" | "useGraphqlAdminApi">> & {
    fetchFn?: typeof fetch;
    useGraphqlAdminApi?: boolean;
  }
): Promise<{ success: boolean; reason?: string }> {
  // GraphQL is the default (REST sunset for public apps on 2025-04-01).
  // `useGraphqlAdminApi === false` opts into the legacy REST path.
  const useGraphql = config.useGraphqlAdminApi !== false;
  if (useGraphql) {
    return createPriceRuleGraphql(offer, discountCode, config);
  }
  return createPriceRuleRest(offer, discountCode, config);
}

/**
 * GraphQL implementation using `discountCodeBasicCreate` (replaces the
 * deprecated `price_rules` REST endpoint). The mutation both creates the
 * price rule (in one place) and attaches the discount code.
 *
 * Ref: https://shopify.dev/docs/api/admin-graphql/mutations/discountCodeBasicCreate
 */
async function createPriceRuleGraphql(
  offer: AuthorizedOffer,
  discountCode: string,
  config: Required<Omit<ShopifyConfig, "fetchFn" | "useGraphqlAdminApi">> & { fetchFn?: typeof fetch }
): Promise<{ success: boolean; reason?: string }> {
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  const isPercentage = offer.type === "discount_percent";
  // GraphQL: percentage values are integers 0-100; fixed_amount values use
  // a Decimal-ish Money input (we send a number string of currency units).
  const isShipping = offer.type.startsWith("shipping");

  const basicDiscountInput = {
    title: `AACP ${discountCode}`,
    startsAt: new Date().toISOString(),
    endsAt: offer.expiresAt ?? undefined,
    usageLimit: 1,
    customerSelection: { all: true },
    customerGetUsageLimit: 1,
    codes: {
      addCodes: [{ code: discountCode }]
    },
    ...(isPercentage
      ? {
          discountClasses: isShipping
            ? ["SHIPPING"]
            : ["PRODUCT", "ORDER"],
          value: { percentage: offer.value / 100 } // GraphQL expects 0.0–1.0 fraction
        }
      : {
          discountClasses: isShipping
            ? ["SHIPPING"]
            : ["PRODUCT", "ORDER"],
          value: { discountAmount: { amount: offer.value.toFixed(2), appliesOnEachItem: false } }
        })
  };

  const mutation = `mutation AacpDiscountCodeBasicCreate($basicDiscountCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicDiscountCodeDiscount: $basicDiscountCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

  try {
    const response = await fetchFn(
      `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.adminAccessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: mutation,
          variables: { basicDiscountCodeDiscount: basicDiscountInput }
        })
      }
    );
    if (!response.ok) {
      return { success: false, reason: `shopify_price_rule_failed_${response.status}` };
    }
    const json = (await response.json()) as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id?: string } | null;
          userErrors?: Array<{ message?: string }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      return { success: false, reason: `shopify_price_rule_graphql_failed: ${json.errors[0]?.message ?? "unknown"}` };
    }
    const userErrors = json.data?.discountCodeBasicCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { success: false, reason: `shopify_price_rule_user_error: ${userErrors[0]?.message ?? "unknown"}` };
    }
    if (!json.data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
      return { success: false, reason: "shopify_price_rule_id_missing" };
    }
    return { success: true };
  } catch {
    return { success: false, reason: "shopify_request_failed" };
  }
}

/**
 * REST implementation (legacy, kept for merchants on older API versions
 * that don't yet expose `discountCodeBasicCreate`).
 */
async function createPriceRuleRest(
  offer: AuthorizedOffer,
  discountCode: string,
  config: Required<Omit<ShopifyConfig, "fetchFn" | "useGraphqlAdminApi">> & { fetchFn?: typeof fetch }
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
