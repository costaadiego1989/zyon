import type { MetaAdsCampaignDraft, MetaAdsProduct } from "@zyon/shared-types";
import { MetaAdsError } from "./types.js";
import { requireIdentifier } from "./offer.js";

function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw new MetaAdsError("campaign_draft_invalid");
  return value.trim();
}
function ids(value: unknown, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 10 || new Set(value).size !== value.length) throw new MetaAdsError("campaign_selection_invalid");
  return value.map(requireIdentifier);
}
export function normalizeCampaignDraft(input: MetaAdsCampaignDraft): MetaAdsCampaignDraft {
  if (!input || typeof input !== "object") throw new MetaAdsError("campaign_draft_invalid");
  if (!["store", "whatsapp"].includes(input.destination)) throw new MetaAdsError("campaign_destination_invalid");
  if (!["paid_sales", "cost_per_purchase", "roas", "contribution"].includes(input.priority)) throw new MetaAdsError("campaign_priority_invalid");
  if (typeof input.country !== "string" || !/^[A-Z]{2}$/.test(input.country)) throw new MetaAdsError("campaign_country_invalid");
  let budget: MetaAdsCampaignDraft["budget"] = null;
  if (input.budget !== null) {
    const b = input.budget;
    if (!b || b.currency !== "BRL" || !["daily", "lifetime"].includes(b.cadence) || !Number.isSafeInteger(b.amountCents) || b.amountCents <= 0 || typeof b.startsAt !== "string" || !Number.isFinite(new Date(b.startsAt).getTime()) ||
      (b.endsAt !== null && (typeof b.endsAt !== "string" || !Number.isFinite(new Date(b.endsAt).getTime()) || new Date(b.endsAt) <= new Date(b.startsAt))) || (b.cadence === "lifetime" && !b.endsAt)) throw new MetaAdsError("campaign_budget_invalid");
    budget = { amountCents: b.amountCents, currency: "BRL", cadence: b.cadence, startsAt: new Date(b.startsAt).toISOString(), endsAt: b.endsAt ? new Date(b.endsAt).toISOString() : null };
  }
  return { name: text(input.name, 120, true), destination: input.destination, priority: input.priority, country: input.country,
    variantIds: ids(input.variantIds, 1), mediaIds: ids(input.mediaIds, 0), headline: text(input.headline, 120), primaryText: text(input.primaryText, 2200), budget };
}
export function assertCommercialTerms(draft: MetaAdsCampaignDraft, products: MetaAdsProduct[]): void {
  const copy = `${draft.headline}\n${draft.primaryText}`;
  if (/\b(?:desconto|off|cupom|brinde|gr[aá]tis)\b|sem\s+juros/i.test(copy)) throw new MetaAdsError("creative_terms_mismatch", 409);
  const prices = [...copy.matchAll(/(?:R\$|\bBRL)\s*(\d(?:[\d.,]*\d)?)|(\d(?:[\d.,]*\d)?)\s*(?:reais?|BRL)\b|\b(?:por|custa|pre[cç]o(?:\s+de)?|apenas|s[oó]|a\s+partir\s+de|de(?=\s+[\d.,]+\s+por\b))\s*(?:R\$|BRL)?\s*(\d(?:[\d.,]*\d)?)/gi)].map(match => {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/.test(raw) && !/^\d+\.\d{2}$/.test(raw)) throw new MetaAdsError("creative_terms_mismatch", 409);
    const numeric = raw.includes(",") ? raw.replaceAll(".", "").replace(",", ".") : /^\d+\.\d{2}$/.test(raw) ? raw : raw.replaceAll(".", "");
    const cents = Math.round(Number(numeric) * 100);
    if (!Number.isSafeInteger(cents)) throw new MetaAdsError("creative_terms_mismatch", 409);
    return cents;
  });
  const allowed = new Set(products.map(product => product.priceCents));
  if (prices.some(price => !allowed.has(price)) || (allowed.size > 1 && prices.length > 0 && (!/a\s+partir\s+de/i.test(copy) || prices.some(price => price !== Math.min(...allowed))))) throw new MetaAdsError("creative_terms_mismatch", 409);
}
