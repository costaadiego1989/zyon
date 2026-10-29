import { z } from "zod";
import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";
import { neighborhoodDeliveryMatchesOrigin, type NeighborhoodDeliveryOrigin } from "./neighborhood-delivery-origin.js";

const cents = z.number().int().min(0).max(2_147_483_647);
export const manualDeliveryConfigSchema = z.object({
  id: z.string().min(1), merchantId: z.string().min(1), enabled: z.boolean(), mode: z.enum(["flat", "neighborhood", "radius"]),
  flatPriceCents: cents.nullable(), freeAboveCents: cents.nullable(),
  neighborhoods: z.array(z.object({ name: z.string().trim().min(1), priceCents: cents })).nullable(),
  radiusZones: z.array(z.object({ maxKm: z.number().positive().nullable(), priceCents: cents }))
    .refine(zones => zones.every((zone, index) => zone.maxKm === null ? index === zones.length - 1
      : index === 0 || zones[index - 1]!.maxKm !== null && zone.maxKm > zones[index - 1]!.maxKm!)).nullable(),
  estimatedValue: z.number().int().positive(), estimatedUnit: z.enum(["minutes", "days"]),
}).refine(config => !config.enabled || config.mode !== "flat" || config.flatPriceCents !== null)
  .refine(config => !config.enabled || config.mode !== "neighborhood" || (config.neighborhoods?.length ?? 0) > 0)
  .refine(config => !config.enabled || config.mode !== "radius" || (config.radiusZones?.length ?? 0) > 0);

export const normalizeDeliveryNeighborhood = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase().trim().replace(/\s+/g, " ");

/** Canonical SERVER configuration/address inputs only. This quotes a tariff;
 * it does not grant a subsidy, prove service geography or measure delivery cost.
 * radiusPriceCents must come from the server's distance calculation, not an API
 * body/model. Null/omitted means no verified radius tariff, never a fallback. */
export function quoteManualDelivery(rawConfig: unknown, input: {
  cartTotalCents: number; neighborhood?: string; radiusPriceCents?: number | null;
  origin?: NeighborhoodDeliveryOrigin; destinationCity?: string; destinationState?: string;
}): ShippingQuoteResult[] {
  const config = manualDeliveryConfigSchema.parse(rawConfig), subtotal = cents.parse(input.cartTotalCents);
  if (!config.enabled) return [];
  let price: number | null = null, carrierKey = "", label = "Entrega própria";
  if (config.mode === "flat") {
    price = config.flatPriceCents; carrierKey = "own_delivery_flat";
  } else if (config.mode === "neighborhood") {
    if (!neighborhoodDeliveryMatchesOrigin(config.merchantId, input.origin, input.destinationCity, input.destinationState)) return [];
    const destination = normalizeDeliveryNeighborhood(input.neighborhood ?? "");
    const matches = destination ? config.neighborhoods!.filter(zone => normalizeDeliveryNeighborhood(zone.name) === destination) : [];
    if (matches.length === 1) {
      const zone = matches[0]!; price = zone.priceCents;
      carrierKey = `own_delivery_neighborhood_${zone.name.toLowerCase().replace(/\s+/g, "_")}`;
      label = `Entrega própria - ${zone.name}`;
    }
  } else if (input.radiusPriceCents != null) {
    price = cents.parse(input.radiusPriceCents); carrierKey = "own_delivery_radius";
  }
  if (price === null) return [];
  const free = config.freeAboveCents !== null && subtotal >= config.freeAboveCents;
  return [{ carrier_key: carrierKey, label, price: free ? 0 : price, ...(free ? { original_price: price } : {}),
    eta_days: config.estimatedUnit === "days" ? config.estimatedValue : Math.ceil(config.estimatedValue / 1440), is_free: free }];
}
