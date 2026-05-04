import type { AcceptedOffer, AuthorizedOffer } from "@aacp/shared-types";

export class AcceptedOfferEntity {
  private constructor(private readonly props: AcceptedOffer) {}

  static accept(input: {
    merchantId: string;
    sessionId: string;
    offer: AuthorizedOffer;
    now?: Date;
  }): AcceptedOfferEntity {
    if (input.offer.merchantId !== input.merchantId || input.offer.sessionId !== input.sessionId) {
      throw new Error("offer_scope_mismatch");
    }
    if (!input.offer.approved) {
      throw new Error("offer_not_approved");
    }
    const now = input.now ?? new Date();
    if (Date.parse(input.offer.expiresAt) <= now.getTime()) {
      throw new Error("offer_expired");
    }

    return new AcceptedOfferEntity({
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      offerId: input.offer.id,
      type: input.offer.type,
      value: input.offer.value,
      marginAfterOffer: input.offer.marginAfterOffer,
      acceptedAt: now.toISOString(),
      expiresAt: input.offer.expiresAt
    });
  }

  static rehydrate(snapshot: AcceptedOffer): AcceptedOfferEntity {
    return new AcceptedOfferEntity(snapshot);
  }

  snapshot(): AcceptedOffer {
    return { ...this.props };
  }
}
