import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SelectShippingMethodUseCase } from "./select-shipping-method.use-case.js";
import { InMemoryShippingQuoteRepository } from "../../infrastructure/repositories/in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

function makeQuoteForSession(opts: {
  merchantId: string;
  sessionId: string;
  destinationZip?: string;
  results?: { carrier_key: string; label: string; price: number; eta_days: number; is_free: boolean }[];
}) {
  const quote = ShippingQuoteEntity.create({
    session_id: opts.sessionId,
    merchant_id: opts.merchantId,
    destination_zip: opts.destinationZip ?? "01310-100"
  });
  return quote.addResults(
    opts.results ?? [
      { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false },
      { carrier_key: "sedex", label: "Sedex", price: 3000, eta_days: 2, is_free: false }
    ]
  );
}

describe("SelectShippingMethodUseCase — error paths", () => {
  it("throws NotFoundException when no quote exists for session", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    const useCase = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo);

    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "missing", carrier_key: "pac" }),
      (err: unknown) => {
        return err instanceof Error && /shipping_quote_not_found/.test(err.message);
      }
    );
  });

  it("throws ConflictException when quote expired", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    const past = new Date("2024-01-01T00:00:00.000Z");
    const expired = ShippingQuoteEntity.create({
      session_id: "sess_old",
      merchant_id: "mrc_1",
      destination_zip: "01310-100",
      created_at: past,
      ttl_seconds: 1
    }).addResults([
      { carrier_key: "pac", label: "PAC", price: 100, eta_days: 1, is_free: false }
    ]);
    await quotesRepo.saveWithEvents(expired);

    const useCase = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo);

    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "sess_old", carrier_key: "pac" }),
      (err: unknown) => {
        return err instanceof Error && /shipping_quote_expired/.test(err.message);
      }
    );
  });

  it("throws BadRequestException when carrier_key not in quote results", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession());
    await quotesRepo.saveWithEvents(makeQuoteForSession({
      merchantId: "mrc_1",
      sessionId: "chk_1"
    }));

    const useCase = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo);

    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "chk_1", carrier_key: "unknown" }),
      (err: unknown) => {
        return err instanceof Error && /shipping_carrier_not_in_quote/.test(err.message);
      }
    );
  });

  it("returns snapshot with selected_carrier_key on success without checkout persistence when no repo", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    await quotesRepo.saveWithEvents(makeQuoteForSession({
      merchantId: "mrc_1",
      sessionId: "sess_a",
      destinationZip: "01310100"
    }));

    // Inject no checkout repo (Optional) — use case should still succeed.
    const useCase = new SelectShippingMethodUseCase(quotesRepo);
    const snap = await useCase.execute({
      merchant_id: "mrc_1",
      session_id: "sess_a",
      carrier_key: "pac"
    });

    assert.equal(snap.selected_carrier_key, "pac");
    // results preserved
    assert.equal(snap.results.length, 2);
  });

  it("is a no-op when checkout session repo present but session not found", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await quotesRepo.saveWithEvents(makeQuoteForSession({
      merchantId: "mrc_1",
      sessionId: "sess_x"
    }));

    const useCase = new SelectShippingMethodUseCase(quotesRepo, checkoutRepo);

    await assert.rejects(
      useCase.execute({ merchant_id: "mrc_1", session_id: "sess_x", carrier_key: "pac" }),
      (err: unknown) => err instanceof Error && /checkout_session_not_found/.test(err.message)
    );
  });

  it("persists destinationZip into the checkout shipping snapshot", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_z",
      shipping: undefined
    }));
    await quotesRepo.saveWithEvents(makeQuoteForSession({
      merchantId: "mrc_1",
      sessionId: "sess_z",
      destinationZip: "20000-000",
      results: [{ carrier_key: "pac", label: "PAC", price: 1290, eta_days: 4, is_free: false }]
    }));

    await new SelectShippingMethodUseCase(quotesRepo, checkoutRepo).execute({
      merchant_id: "mrc_1",
      session_id: "sess_z",
      carrier_key: "pac"
    });

    const session = await checkoutRepo.getSession("mrc_1", "sess_z");
    assert.equal(session?.shipping?.destinationZip, "20000-000");
    assert.equal(session?.shipping?.deliveryDays, 4);
    assert.equal(session?.shipping?.customerPrice, 12.9);
  });

  it("free shipping persists as customerPrice=0 and realCost=0", async () => {
    const quotesRepo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
    const checkoutRepo = new InMemoryCheckoutRepository();
    await checkoutRepo.saveSession(checkoutSession({
      merchantId: "mrc_1",
      sessionId: "sess_free",
      shipping: undefined
    }));
    await quotesRepo.saveWithEvents(makeQuoteForSession({
      merchantId: "mrc_1",
      sessionId: "sess_free",
      destinationZip: "01310100",
      results: [{ carrier_key: "free", label: "Frete Grátis", price: 0, eta_days: 7, is_free: true }]
    }));

    await new SelectShippingMethodUseCase(quotesRepo, checkoutRepo).execute({
      merchant_id: "mrc_1",
      session_id: "sess_free",
      carrier_key: "free"
    });

    const session = await checkoutRepo.getSession("mrc_1", "sess_free");
    assert.equal(session?.shipping?.customerPrice, 0);
    assert.equal(session?.shipping?.realCost, 0);
    assert.equal(session?.shipping?.carrier, "free");
    assert.equal(session?.shipping?.method, "Frete Grátis");
  });
});
