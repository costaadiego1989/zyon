import { z } from "zod";

const text = z.string().trim().min(1).max(191).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const zip = z.string().regex(/^\d{5}-?\d{3}$/).transform(value => value.replace("-", "")).refine(value => value !== "00000000");
const state = z.string().trim().transform(value => value.toUpperCase()).pipe(z.enum([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]));
export const neighborhoodDeliveryOriginSchema = z.strictObject({ merchantId: text, zip, city: text, state });
export type NeighborhoodDeliveryOrigin = { merchantId: string; zip: string; city: string; state: string };
export type NeighborhoodDeliveryOriginResult = { kind: "ready"; origin: NeighborhoodDeliveryOrigin }
  | { kind: "needs_origin_address_configuration" };
export const normalizeDeliveryLocality = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .trim().toLowerCase().replace(/\s+/g, " ");

export function neighborhoodDeliveryMatchesOrigin(merchantId: string, rawOrigin: unknown, city: unknown, uf: unknown): boolean {
  const origin = neighborhoodDeliveryOriginSchema.safeParse(rawOrigin), destinationCity = text.safeParse(city), destinationState = state.safeParse(uf);
  return origin.success && destinationCity.success && destinationState.success && origin.data.merchantId === merchantId
    && normalizeDeliveryLocality(origin.data.city) === normalizeDeliveryLocality(destinationCity.data)
    && origin.data.state === destinationState.data;
}

/** Configured server data only. A matching CEP binds the company locality to
 * the merchant's actual configured shipping origin; no inference or geocoder. */
export function resolveNeighborhoodDeliveryOrigin(merchantId: string, rawMerchant: unknown, rawRule: unknown): NeighborhoodDeliveryOriginResult {
  const merchant = z.object({ id: text, storeSettings: z.object({ company: z.object({ address: z.object({ zip, city: text, state }) }) }) }).safeParse(rawMerchant);
  const rule = z.object({ merchantId: text, originZip: zip }).safeParse(rawRule);
  if (!merchant.success || !rule.success || merchant.data.id !== merchantId || rule.data.merchantId !== merchantId
    || merchant.data.storeSettings.company.address.zip !== rule.data.originZip) return { kind: "needs_origin_address_configuration" };
  return { kind: "ready", origin: { merchantId, ...merchant.data.storeSettings.company.address } };
}
