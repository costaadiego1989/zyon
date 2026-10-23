import type { PackageDimensions } from "@zyon/shared-types";
import type { StorefrontShippingReferenceScope, StorefrontShippingReferenceRequest, StorefrontShippingReferenceResult, ShippingReferenceReason } from "../contracts/storefront-shipping-reference.schemas.js";

export const STOREFRONT_SHIPPING_REFERENCE = Symbol("STOREFRONT_SHIPPING_REFERENCE");
export interface StorefrontShippingReferencePort {
  quote(scope: StorefrontShippingReferenceScope, request: StorefrontShippingReferenceRequest): Promise<StorefrontShippingReferenceResult>;
}
/** Internal canonical reader result, never a body/model/provider DTO. */
export type StorefrontShippingReferenceAuthority = { kind: "ready"; basisHash: string; configurationHash: string;
  cartTotalCents: number; originZip: string; destinationZip: string; destinationNeighborhood?: string;
  addressSource: "saved_buyer_address" | "requested_cep"; mode: "flat" | "neighborhood" | "radius" | "carrier";
  packages?: PackageDimensions[]; items: Array<{ sku: string; quantity: number }>;
} | { kind: "unavailable"; reason: ShippingReferenceReason };
export interface StorefrontShippingReferenceReader {
  read(scope: StorefrontShippingReferenceScope, request: StorefrontShippingReferenceRequest): Promise<StorefrontShippingReferenceAuthority>;
}
