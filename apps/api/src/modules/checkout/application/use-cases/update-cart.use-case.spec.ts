import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UpdateCartUseCase } from "./update-cart.use-case.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, testCart } from "../../__tests__/checkout-test-fixtures.js";

function setup() {
  const repo = new InMemoryCheckoutRepository();
  repo.saveSession(
    checkoutSession({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      cart: testCart({
        currency: "BRL",
        total: 350,
        items: [
          { sku: "a", name: "A", price: 100, cost: 40, quantity: 1 },
          { sku: "b", name: "B", price: 125, cost: 50, quantity: 2 }
        ]
      })
    })
  );
  const useCase = new UpdateCartUseCase(repo, repo);
  return { repo, useCase };
}

describe("UpdateCartUseCase", () => {
  it("rejects quantity above native variant stock before mutating the session or discount", async () => {
    const { repo } = setup();
    const session = repo.getSession("mrc_1", "chk_1")!;
    session.cart.items[1].variantId = "native-b";
    session.cart.currentDiscount = 10;
    repo.saveSession(session);
    const before = JSON.stringify(session.cart);
    const prisma = { productVariant: { findMany: async () => [{ id: "native-b", sku: "b", isActive: true, product: { isActive: true, deletedAt: null, type: "physical" }, stock: [{ quantity: 2, reserved: 0 }] }] } } as any;
    const useCase = new UpdateCartUseCase(repo, repo, undefined, undefined, undefined, prisma);
    await assert.rejects(useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [{ sku: "b", quantity: 3 }] }), /cart_insufficient_stock/);
    assert.equal(JSON.stringify(repo.getSession("mrc_1", "chk_1")!.cart), before);
  });
  it("updates quantity and recomputes total from server-held prices", async () => {
    const { repo, useCase } = setup();

    const res = await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      items: [{ sku: "b", quantity: 1 }]
    });

    const session = repo.getSession("mrc_1", "chk_1");
    assert.equal(session?.cart.total, 225); // 100*1 + 125*1
    assert.equal(res.experience.totals.total, 225);
  });

  it("removes an item when quantity is zero", async () => {
    const { repo, useCase } = setup();

    await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      items: [{ sku: "a", quantity: 0 }]
    });

    const session = repo.getSession("mrc_1", "chk_1");
    assert.equal(session?.cart.items.length, 1);
    assert.equal(session?.cart.items[0]?.sku, "b");
    assert.equal(session?.cart.total, 250); // 125*2
  });

  it("rejects unknown sku", async () => {
    const { useCase } = setup();
    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [{ sku: "zzz", quantity: 1 }] }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it("rejects non-integer or out-of-range quantity", async () => {
    const { useCase } = setup();
    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [{ sku: "a", quantity: 1.5 }] }),
      (err: unknown) => err instanceof BadRequestException
    );
    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [{ sku: "a", quantity: 100 }] }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it("rejects empty items", async () => {
    const { useCase } = setup();
    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", items: [] }),
      (err: unknown) => err instanceof BadRequestException
    );
  });

  it("throws NotFound for unknown session (tenant scope)", async () => {
    const { useCase } = setup();
    await assert.rejects(
      useCase.execute({ merchant_id: "other", session_id: "chk_1", items: [{ sku: "a", quantity: 1 }] }),
      (err: unknown) => err instanceof NotFoundException
    );
  });

  it("clears stale shipping and emits outbox event on change", async () => {
    const { repo, useCase } = setup();

    await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      items: [{ sku: "b", quantity: 3 }]
    });

    const session = repo.getSession("mrc_1", "chk_1");
    assert.equal(session?.shipping, undefined);
    const events = repo.listOutbox("mrc_1").filter((e) => e.event_type === "checkout.cart.updated");
    assert.equal(events.length, 1);
  });

  it("clears an applied commercial nudge when a cart change invalidates its price", async () => {
    const { repo, useCase } = setup();
    repo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "chk_1",
      cart: testCart({
        currency: "BRL",
        total: 350,
        currentDiscount: 35,
        commercialNudge: {
          kind: "coupon",
          title: "Cupom aplicado",
          message: "O cupom SAVE10 foi aplicado.",
          couponCode: "SAVE10",
        },
        items: [
          { sku: "a", name: "A", price: 100, cost: 40, quantity: 1 },
          { sku: "b", name: "B", price: 125, cost: 50, quantity: 2 },
        ],
      }),
    }));

    await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      items: [{ sku: "b", quantity: 1 }],
    });

    const session = repo.getSession("mrc_1", "chk_1");
    assert.equal(session?.cart.currentDiscount, 0);
    assert.equal(session?.cart.commercialNudge, undefined);
  });

  it("does not emit outbox or clear shipping when cart unchanged", async () => {
    const { repo, useCase } = setup();

    await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      items: [{ sku: "a", quantity: 1 }] // already quantity 1
    });

    const session = repo.getSession("mrc_1", "chk_1");
    assert.ok(session?.shipping); // preserved
    const events = repo.listOutbox("mrc_1").filter((e) => e.event_type === "checkout.cart.updated");
    assert.equal(events.length, 0);
  });
});
