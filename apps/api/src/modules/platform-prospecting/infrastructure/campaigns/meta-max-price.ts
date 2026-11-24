import { validateProspectingMaxPrice, type ProspectingMaxPrice } from "@zyon/shared-types";
import type { PlatformSenderCredential } from "../../application/campaigns/sender-readiness.service.js";
import { platformGraph } from "./platform-meta-authorization.js";

export function optimizationSpec(price: ProspectingMaxPrice) {
  return { bid_amount: validateProspectingMaxPrice(price)!.amountPerThousandMinor, bid_strategy: "LOWEST_COST_WITH_BID_CAP" };
}

export function observedMaxPrice(value: unknown): ProspectingMaxPrice | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw Error("template_pricing_mismatch");
  const spec = value as Record<string, unknown>;
  if (Object.keys(spec).some(key => !["bid_amount", "bid_strategy", "bid_country_multiplier_overrides"].includes(key))) throw Error("template_pricing_mismatch");
  const overrides = spec.bid_country_multiplier_overrides;
  if (overrides !== undefined && overrides !== null &&
      (typeof overrides !== "object" || Object.keys(overrides).length !== 0)) throw Error("template_pricing_mismatch");
  if (spec.bid_amount === null && spec.bid_strategy === null) return null;
  if (spec.bid_strategy !== "LOWEST_COST_WITH_BID_CAP") throw Error("template_pricing_mismatch");
  return validateProspectingMaxPrice({ currency: "BRL", amountPerThousandMinor: spec.bid_amount });
}

/** Enrollment is verified against the same dedicated platform credential and owner. */
export async function verifyMaxPriceEnrollment(c: PlatformSenderCredential, transport: typeof fetch) {
  const read = async (path: string, fields?: string) => {
    const url = new URL(path, platformGraph);
    if (fields) url.searchParams.set("fields", fields);
    const response = await transport(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Authorization: "Bearer " + c.accessToken } });
    if (!response.ok) throw Error("max_price_unavailable");
    return await response.json();
  };
  const [agreement, account] = await Promise.all([
    read(c.businessId + "/max_price_agreements"),
    read(c.binding.wabaId, "id,currency,marketing_messages_onboarding_status,owner_business_info"),
  ]);
  if (agreement.status !== "accepted") throw Error("max_price_agreement_required");
  if (account.id !== c.binding.wabaId || account.owner_business_info?.id !== c.businessId ||
      account.currency !== "BRL" || account.marketing_messages_onboarding_status !== "ONBOARDED") throw Error("max_price_unavailable");
}
