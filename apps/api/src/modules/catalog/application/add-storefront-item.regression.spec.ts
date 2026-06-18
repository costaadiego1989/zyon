/**
 * Regression tests for ADR-0001 (catalog storefront) — AddStorefrontItemUseCase.
 * Covers P2: in-place mutation bug and lost-update from two separate writes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { AddStorefrontItemUseCase } from "./add-storefront-item.use-case.js";
import { checkoutSession, testCart } from "../../checkout/__tests__/checkout-test-fixtures.js";
import type { SuggestedProduct } from "@aacp/shared-types";
import type { StorefrontCatalogPort } from "../domain/ports/storefront-catalog.port.js";

class FakeCatalog implements StorefrontCatalogPort {
  async search(_merchantId: string, _query: string): Promise<SuggestedProduct[]> {
    return [];
  }
  async findBySku(_merchantId: string, sku: string): Promise<SuggestedProduct | null> {
    if (sku === "PROD-1") return { sku: "PROD-1", name: "Product One", unit_price: 50 };
    return null;
  }
}

function setup() {
  const repo = new InMemoryCheckoutRepository();
  repo.saveSession(
    checkoutSession({
      sessionId: "cat_sess_1",
      cart: testCart({
        total: 0,
        items: []
      })
    })
  );
  return new AddStorefrontItemUseCase(new FakeCatalog(), repo, repo);
}

describe("P2 — AddStorefrontItemUseCase does not mutate the original session's items in place", () => {
  it("does not mutate items in the loaded session object", async () => {
    const repo = new InMemoryCheckoutRepository();
    const originalSession = checkoutSession({
      sessionId: "cat_sess_2",
      cart: testCart({
        total: 50,
        items: [{ sku: "PROD-1", name: "Product One", price: 50, quantity: 1 }]
      })
    });
    repo.saveSession(originalSession);
    const captured = { ...originalSession, cart: { ...originalSession.cart, items: [...originalSession.cart.items] } };

    const useCase = new AddStorefrontItemUseCase(new FakeCatalog(), repo, repo);
    await useCase.execute({ merchant_id: "mrc_1", session_id: "cat_sess_2", sku: "PROD-1", quantity: 2 });

    // The captured original should be unchanged (no in-place mutation)
    assert.equal(captured.cart.items[0]?.quantity, 1, "Original loaded item must not be mutated (was 1, should still be 1)");
  });

  it("correctly accumulates quantity when same SKU added twice", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(
      checkoutSession({
        sessionId: "cat_sess_3",
        cart: testCart({ total: 0, items: [] })
      })
    );
    const useCase = new AddStorefrontItemUseCase(new FakeCatalog(), repo, repo);

    await useCase.execute({ merchant_id: "mrc_1", session_id: "cat_sess_3", sku: "PROD-1", quantity: 2 });
    await useCase.execute({ merchant_id: "mrc_1", session_id: "cat_sess_3", sku: "PROD-1", quantity: 3 });

    const session = repo.getSession("mrc_1", "cat_sess_3");
    assert.equal(session?.cart.items.length, 1, "Should still be one item");
    assert.equal(session?.cart.items[0]?.quantity, 5, "Quantity should accumulate: 2+3=5");
  });

  it("computes cart total correctly (gross, no discount embedded)", async () => {
    const repo = new InMemoryCheckoutRepository();
    repo.saveSession(
      checkoutSession({
        sessionId: "cat_sess_4",
        cart: testCart({ total: 0, items: [] })
      })
    );
    const useCase = new AddStorefrontItemUseCase(new FakeCatalog(), repo, repo);

    await useCase.execute({ merchant_id: "mrc_1", session_id: "cat_sess_4", sku: "PROD-1", quantity: 3 });

    const session = repo.getSession("mrc_1", "cat_sess_4");
    // 3 × 50 = 150 (gross)
    assert.equal(session?.cart.total, 150, "Cart total should be 3 × 50 = 150");
  });
});
