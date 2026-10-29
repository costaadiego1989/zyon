/** Store-settings fields take precedence, including an explicit removal. */
export function resolveStorePolicies(settings: unknown, legacy: unknown = null, links: unknown = null): Record<string, string> {
  const configured = record(record(settings).policies);
  const previous = record(legacy);
  const linked = record(links ?? record(settings).checkoutPolicyLinks);
  const linkFields: Record<string, string> = { privacy: "privacyUrl", terms: "termsUrl", returns: "refundUrl", shipping: "shippingUrl" };
  const result: Record<string, string> = {};
  for (const field of ["privacy", "terms", "returns", "shipping", "warranty", "payment", "general"]) {
    const value = Object.hasOwn(configured, field) ? configured[field] : publicPolicyUrl(linked[linkFields[field]]) ?? previous[field];
    if (typeof value === "string" && value.trim()) result[field] = value.trim();
  }
  return result;
}

export function publicPolicyUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function checkoutPolicyLinks(settings: unknown, rules: unknown, storefrontUrl: string) {
  const store = record(settings);
  const policies = record(store.policies);
  const configuredLinks = record(rules ?? store.checkoutPolicyLinks);
  const result: Record<string, string> = {};
  const fields = { privacy: "privacyUrl", terms: "termsUrl", returns: "refundUrl", shipping: "shippingUrl" };
  const slug = typeof store.slug === "string" ? store.slug : undefined;
  const base = publicPolicyUrl(storefrontUrl);
  for (const [field, link] of Object.entries(fields)) {
    const value = policies[field];
    if (Object.hasOwn(policies, field)) {
      if (typeof value === "string" && value.trim()) {
        const url = publicPolicyUrl(value);
        if (url) result[link] = url;
        else if (slug && base) result[link] = new URL(`/store/${encodeURIComponent(slug)}/politicas#${field}`, base).href;
      }
    } else {
      const url = publicPolicyUrl(configuredLinks[link]);
      if (url) result[link] = url;
    }
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
