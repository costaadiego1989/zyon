import type { StorefrontShippingReferencePort, StorefrontShippingReferenceReader } from "../../domain/ports/storefront-shipping-reference.port.js";
import { storefrontShippingReferenceAuthoritySchema, storefrontShippingReferenceRequestSchema, storefrontShippingReferenceResultSchema,
  storefrontShippingReferenceScopeSchema, shippingReferenceUnavailable, shippingReferenceReasonSchema } from "../../domain/contracts/storefront-shipping-reference.schemas.js";
import type { QuoteShippingUseCase } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";

/** No cart writer/TTL refresh/selection/payment here. Remote IO runs outside
 * reader transactions; re-read hashes afterward before displaying a reference. */
export class QuoteStorefrontShippingReferenceService implements StorefrontShippingReferencePort {
  constructor(private readonly reader: StorefrontShippingReferenceReader, private readonly shipping: Pick<QuoteShippingUseCase, "executeReference">) {}

  async quote(rawScope: Parameters<StorefrontShippingReferencePort["quote"]>[0], rawRequest: Parameters<StorefrontShippingReferencePort["quote"]>[1]) {
    const scope = storefrontShippingReferenceScopeSchema.safeParse(rawScope), request = storefrontShippingReferenceRequestSchema.safeParse(rawRequest);
    if (!scope.success) return shippingReferenceUnavailable("shipping_reference_unavailable");
    if (!request.success) return shippingReferenceUnavailable("invalid_destination");
    try {
      const source = storefrontShippingReferenceAuthoritySchema.parse(await this.reader.read(scope.data, request.data));
      if (source.kind === "unavailable") return shippingReferenceUnavailable(source.reason);
      if (source.destinationZip !== request.data.zipCode || source.mode === "neighborhood"
        && (source.addressSource !== "saved_buyer_address" || !source.destinationNeighborhood)) return shippingReferenceUnavailable("source_changed");
      const quote = await this.shipping.executeReference({ session_id: scope.data.cartId, merchant_id: scope.data.merchantId,
        destination_zip: source.destinationZip, cart_total: source.cartTotalCents / 100, origin_zip: source.originZip,
        ...(source.destinationNeighborhood ? { destination_neighborhood: source.destinationNeighborhood } : {}),
        ...(source.destinationCity ? { destination_city: source.destinationCity } : {}),
        ...(source.destinationState ? { destination_state: source.destinationState } : {}),
        ...(source.packages ? { packages: source.packages } : {}), items: source.items,
        basisHash: source.basisHash, configurationHash: source.configurationHash });
      if (!quote.results.length || quote.reason) {
        const reason = shippingReferenceReasonSchema.safeParse(quote.reason);
        return shippingReferenceUnavailable(reason.success ? reason.data : "carrier_unavailable");
      }
      const current = storefrontShippingReferenceAuthoritySchema.parse(await this.reader.read(scope.data, request.data));
      if (current.kind !== "ready" || current.basisHash !== source.basisHash || current.configurationHash !== source.configurationHash
        || quote.basisHash !== source.basisHash || quote.configurationHash !== source.configurationHash || Date.parse(quote.expiresAt) <= Date.now())
        return shippingReferenceUnavailable("source_changed");
      return storefrontShippingReferenceResultSchema.parse({ referenceOnly: true,
        options: quote.results.map(option => ({ carrier: option.carrier_key, name: option.label, price: option.price, days: option.eta_days, zipCode: source.destinationZip })),
        reference: { id: quote.id, expiresAt: quote.expiresAt, basisHash: source.basisHash, configurationHash: source.configurationHash,
          destinationZip: source.destinationZip, addressSource: source.addressSource } });
    } catch {
      // Read-only failures never invent a successful fallback or leak address,
      // provider errors or private catalog payloads to the LLM/public result.
      return shippingReferenceUnavailable("shipping_reference_unavailable");
    }
  }
}
