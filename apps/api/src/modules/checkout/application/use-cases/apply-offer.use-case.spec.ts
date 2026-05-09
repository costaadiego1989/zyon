import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorizedOffer } from "@aacp/shared-types";
import { authorizedOffer, checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import { AcceptCheckoutOfferUseCase } from "./accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "./apply-offer.use-case.js";

class FakeCommerceOfferPort implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    return {
      success: true,
      discount_code: offer.discountCode,
      apply_url: `https://shop.example/discount/${offer.discountCode}`
    };
  }
}

test("ApplyOfferUseCase applies approved offers and records checkout acceptance", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.saveOffer(authorizedOffer());
  const useCase = new ApplyOfferUseCase(
    repository,
    repository,
    new FakeCommerceOfferPort(),
    new AcceptCheckoutOfferUseCase(repository, repository, repository)
  );

  const response = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });

  assert.equal(response.success, true);
  assert.equal(response.new_total, 270);
  assert.equal(repository.getAcceptedOffer("mrc_1", "chk_1", "off_1")?.offerId, "off_1");
});

test("ApplyOfferUseCase blocks expired offers before commerce application", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.saveOffer(authorizedOffer({ expiresAt: "2020-01-01T00:00:00.000Z" }));
  const useCase = new ApplyOfferUseCase(
    repository,
    repository,
    new FakeCommerceOfferPort(),
    new AcceptCheckoutOfferUseCase(repository, repository, repository)
  );

  const response = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });

  assert.equal(response.success, false);
  assert.equal(response.reason, "offer_expired");
});

test("ApplyOfferUseCase returns refreshed experience and appends agent turn after success", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.saveOffer(authorizedOffer({ type: "discount_percent", value: 10 }));
  const useCase = new ApplyOfferUseCase(
    repository,
    repository,
    new FakeCommerceOfferPort(),
    new AcceptCheckoutOfferUseCase(repository, repository, repository)
  );

  const response = await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });

  assert.equal(response.success, true);
  assert.ok(response.experience, "experience returned");
  assert.equal(response.experience?.totals.discount, 30);
  assert.equal(response.experience?.totals.total, 305);
  assert.ok(response.agent_turn);
  assert.equal(response.agent_turn?.role, "agent");
  assert.match(response.agent_turn?.text ?? "", /pagamento/i);

  const session = await repository.getSession("mrc_1", "chk_1");
  assert.equal(session?.cart.currentDiscount, 30);
  assert.equal(session?.chatHistory.at(-1)?.role, "agent");
  assert.equal(session?.chatHistory.at(-1)?.authorizedOfferId, "off_1");
});

test("ApplyOfferUseCase keeps the largest discount when applied twice", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  repository.saveOffer(authorizedOffer({ type: "discount_percent", value: 10 }));
  const useCase = new ApplyOfferUseCase(
    repository,
    repository,
    new FakeCommerceOfferPort(),
    new AcceptCheckoutOfferUseCase(repository, repository, repository)
  );

  await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });
  await useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" });
  const session = await repository.getSession("mrc_1", "chk_1");
  assert.equal(session?.cart.currentDiscount, 30);
  assert.equal(session?.chatHistory.filter((t) => t.role === "agent").length, 2);
});
