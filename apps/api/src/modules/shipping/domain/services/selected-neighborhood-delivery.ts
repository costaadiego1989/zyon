import type { CustomerAddress, ShippingQuote } from "@zyon/shared-types";
import type { ShippingQuoteSnapshot, ShippingQuoteResult } from "../entities/shipping-quote.entity.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "./manual-delivery-quote.js";
import { neighborhoodDeliveryMatchesOrigin, type NeighborhoodDeliveryOriginResult } from "./neighborhood-delivery-origin.js";
import { toCheckoutShippingQuote } from "./checkout-shipping-quote.mapper.js";

export type SelectedNeighborhoodDeliveryInput = {
  merchantId: string; sessionId: string; selected: ShippingQuote | null | undefined;
  address: CustomerAddress | undefined; addressVerified: boolean; config: unknown;
  origin: NeighborhoodDeliveryOriginResult | undefined; cartTotalCents: number;
  sourceQuote: Pick<ShippingQuoteSnapshot, "merchant_id" | "session_id" | "destination_zip" | "results"> | null | undefined;
};
export type SelectedNeighborhoodDeliveryDecision = { kind: "not_neighborhood" | "authorized" }
  | { kind: "requires_review"; reason: "origin_address_configuration_required" | "neighborhood_quote_review_required" | "neighborhood_destination_outside_origin_city" };
const neighborhoodKey = (value: string | undefined) => value?.startsWith("own_delivery_neighborhood_") === true;
const cep = (value: unknown) => typeof value === "string" && /^\d{5}-?\d{3}$/.test(value) ? value.replace("-", "") : undefined;
const sameMoneyAndDelivery = (left: ShippingQuote, right: ShippingQuote) => left.customerPrice === right.customerPrice
  && left.deliveryDays === right.deliveryDays && cep(left.destinationZip) !== undefined && cep(left.destinationZip) === cep(right.destinationZip);
const sameTariff = (left: ShippingQuoteResult, right: ShippingQuoteResult) => left.carrier_key === right.carrier_key
  && left.label === right.label && left.price === right.price && left.original_price === right.original_price
  && left.eta_days === right.eta_days && left.is_free === right.is_free;

/** Pure scope check over actual server sources. It grants no payment/subsidy
 * and authenticates no request. Callers must read these sources under their
 * own transaction/fences; analytic realCost is deliberately not eligibility. */
export function evaluateSelectedNeighborhoodDelivery(input: SelectedNeighborhoodDeliveryInput): SelectedNeighborhoodDeliveryDecision {
  const { selected } = input;
  if (!selected) return { kind: "not_neighborhood" };
  const review = (): SelectedNeighborhoodDeliveryDecision => ({ kind: "requires_review", reason: "neighborhood_quote_review_required" });
  const source = input.sourceQuote?.merchant_id === input.merchantId && input.sourceQuote.session_id === input.sessionId ? input.sourceQuote : undefined;
  const config = manualDeliveryConfigSchema.safeParse(input.config);
  const candidates = source?.results.filter(option => neighborhoodKey(option.carrier_key)) ?? [];
  const named = candidates.filter(option => {
    const mapped = toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key, priceInCents: option.price,
      realCostInCents: option.original_price ?? option.price, isFree: option.is_free, etaDays: option.eta_days, destinationZip: source!.destination_zip });
    return neighborhoodKey(selected.carrier) ? selected.carrier === option.carrier_key && selected.method === option.label
      : selected.carrier === mapped.carrier && selected.method === mapped.method;
  });
  if (!neighborhoodKey(selected.carrier) && !named.length) {
    // A lone/unknown manual label is not a proven non-neighborhood carrier.
    // Known flat/radius selections retain their existing separate scope.
    if (selected.carrier === "Entrega") {
      const provenOther = source?.results.filter(option => !neighborhoodKey(option.carrier_key)).filter(option => {
        const mapped = toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key, priceInCents: option.price,
          realCostInCents: option.original_price ?? option.price, isFree: option.is_free, etaDays: option.eta_days, destinationZip: source.destination_zip });
        return selected.carrier === mapped.carrier && selected.method === mapped.method && sameMoneyAndDelivery(selected, mapped);
      });
      if (provenOther?.length !== 1) return review();
    }
    return { kind: "not_neighborhood" };
  }
  if (!source || named.length !== 1) return review();
  const option = named[0]!;
  if (!sameMoneyAndDelivery(selected, { customerPrice: option.price / 100, deliveryDays: option.eta_days, destinationZip: source.destination_zip })) return review();
  if (!config.success || config.data.merchantId !== input.merchantId || !config.data.enabled || config.data.mode !== "neighborhood") return review();
  if (input.origin?.kind !== "ready") return { kind: "requires_review", reason: "origin_address_configuration_required" };
  const address = input.address;
  if (!input.addressVerified || !address || cep(address.zip) !== cep(source.destination_zip)
    || !neighborhoodDeliveryMatchesOrigin(input.merchantId, input.origin.origin, address.city, address.state))
    return { kind: "requires_review", reason: "neighborhood_destination_outside_origin_city" };
  if (!quoteManualDelivery(config.data, { cartTotalCents: input.cartTotalCents, neighborhood: address.neighborhood,
    origin: input.origin.origin, destinationCity: address.city, destinationState: address.state }).some(current => sameTariff(current, option))) return review();
  return { kind: "authorized" };
}
