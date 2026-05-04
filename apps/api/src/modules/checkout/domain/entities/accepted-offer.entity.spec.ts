import test from "node:test";
import assert from "node:assert/strict";
import { AcceptedOfferEntity } from "./accepted-offer.entity.js";
import { authorizedOffer } from "../../__tests__/checkout-test-fixtures.js";

test("AcceptedOfferEntity accepts approved, in-scope, unexpired offers", () => {
  const accepted = AcceptedOfferEntity.accept({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    offer: authorizedOffer(),
    now: new Date("2026-05-01T12:00:00.000Z")
  }).snapshot();

  assert.equal(accepted.offerId, "off_1");
  assert.equal(accepted.type, "discount_percent");
  assert.equal(accepted.acceptedAt, "2026-05-01T12:00:00.000Z");
});

test("AcceptedOfferEntity rejects unapproved, expired, or cross-scope offers", () => {
  assert.throws(() =>
    AcceptedOfferEntity.accept({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      offer: authorizedOffer({ approved: false })
    })
  );
  assert.throws(() =>
    AcceptedOfferEntity.accept({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      offer: authorizedOffer({ expiresAt: "2020-01-01T00:00:00.000Z" })
    })
  );
  assert.throws(() =>
    AcceptedOfferEntity.accept({
      merchantId: "mrc_2",
      sessionId: "chk_1",
      offer: authorizedOffer()
    })
  );
});
