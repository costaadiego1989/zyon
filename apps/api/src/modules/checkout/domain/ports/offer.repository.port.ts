import type { AcceptedOffer, AuthorizedOffer } from "@aacp/shared-types";

export const OFFER_REPOSITORY = Symbol("OFFER_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface OfferRepository {
  saveOffer(offer: AuthorizedOffer): MaybePromise<AuthorizedOffer>;
  getOffer(merchantId: string, offerId: string): MaybePromise<AuthorizedOffer | undefined>;
  saveAcceptedOffer(offer: AcceptedOffer): MaybePromise<void>;
  getAcceptedOffer(merchantId: string, sessionId: string, offerId: string): MaybePromise<AcceptedOffer | undefined>;
}
