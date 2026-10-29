import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, authorizedOffer } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { AcceptCheckoutOfferUseCase } from "../application/use-cases/accept-checkout-offer.use-case.js";

test("AcceptCheckoutOfferUseCase records accepted offers once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.saveOffer(authorizedOffer());
  const useCase = new AcceptCheckoutOfferUseCase(repository, repository, repository);

  const first = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });
  const second = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });

  assert.equal(first.offerId, "off_1");
  assert.deepEqual(first, second);
  assert.equal(repository.listOutbox("mrc_1").length, 1);
});
