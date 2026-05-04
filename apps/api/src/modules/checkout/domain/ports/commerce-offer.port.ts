import type { ApplyOfferResponse, AuthorizedOffer } from "@aacp/shared-types";

export const COMMERCE_OFFER_PORT = Symbol("COMMERCE_OFFER_PORT");

export interface CommerceOfferPort {
  apply(offer: AuthorizedOffer): Promise<Pick<ApplyOfferResponse, "success" | "discount_code" | "apply_url" | "reason">>;
}
