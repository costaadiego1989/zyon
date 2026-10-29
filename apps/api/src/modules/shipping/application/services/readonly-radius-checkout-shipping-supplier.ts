import { z } from "zod";
import type { ReadonlyCheckoutShippingRequest, ReadonlyCheckoutShippingSupplier } from "../../domain/ports/readonly-checkout-shipping-supplier.port.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../domain/services/manual-delivery-quote.js";
import { geocodeBrazilianCep, getPriceForDistance, haversineDistance } from "../../domain/services/distance-calculator.service.js";
import { providerShippingResultSchema } from "../../../cross-sell/domain/contracts/widget-checkout-provider-shipping.schemas.js";

const coordinates = z.strictObject({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
/** Existing CEP-centroid approximation ONLY, not address/distance verification.
 * Default geocoder reads external providers; never execute under a DB tx. */
export class ReadonlyRadiusCheckoutShippingSupplier implements ReadonlyCheckoutShippingSupplier {
  constructor(private readonly geocode = geocodeBrazilianCep) {}

  async quote(request: ReadonlyCheckoutShippingRequest) {
    if (request.mode !== "radius") throw Error("widget_radius_shipping_mode_required");
    z.uuidv4().parse(request.requestId);
    z.iso.datetime({ offset: true }).parse(request.expiresAt);
    z.string().regex(/^[a-f0-9]{64}$/).parse(request.metadataHash);
    const originZip = z.string().regex(/^\d{8}$/).parse(request.originZip);
    const destinationZip = z.string().regex(/^\d{8}$/).parse(request.destinationZip);
    const config = manualDeliveryConfigSchema.parse(request.config);
    if (!config.enabled || config.mode !== "radius" || config.merchantId !== request.merchantId) throw Error("widget_radius_shipping_config_invalid");
    const origin = coordinates.parse(await this.geocode(originZip)), destination = coordinates.parse(await this.geocode(destinationZip));
    const distanceKm = haversineDistance(origin.lat, origin.lng, destination.lat, destination.lng);
    const price = getPriceForDistance(distanceKm, config.radiusZones!);
    // A configured tariff is NOT realCost. Do not apply its free threshold yet.
    const options = quoteManualDelivery({ ...config, freeAboveCents: null }, { cartTotalCents: 0, radiusPriceCents: price })
      .map(({ carrier_key, label, price: amount, eta_days }) => ({ carrier_key, label, price: amount, eta_days }));
    return providerShippingResultSchema.parse({ requestId: request.requestId, mode: "radius", expiresAt: request.expiresAt,
      options, evidence: { kind: "cep_haversine", originZip, destinationZip, distanceKm } });
  }
}
