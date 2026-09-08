import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, completeOrderRequest } from "./checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { BuyerPurchaseHistoryAdapter } from "../infrastructure/adapters/buyer-purchase-history.adapter.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import { AttributionTaggerService } from "../../revenue-lift/domain/services/attribution-tagger.service.js";
import type { PurchaseHistoryPort, RecordCheckoutPurchaseInput } from "../domain/ports/purchase-history.port.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import {
  GetBuyerPurchaseContextUseCase,
  RecordCompletedPurchaseUseCase
} from "../../buyer-purchase-history/application/buyer-purchase-history.use-cases.js";

class RecordingPurchaseHistoryPort implements PurchaseHistoryPort {
  public records: RecordCheckoutPurchaseInput[] = [];

  async recordCheckoutPurchase(input: RecordCheckoutPurchaseInput): Promise<void> {
    this.records.push(input);
  }
}

class RecordingRevenueLiftRepository {
  public tags: Array<{ orderValueCents: number; discountGivenCents: number }> = [];

  async saveTag(input: { orderValueCents: number; discountGivenCents: number }): Promise<void> {
    this.tags.push(input);
  }
}

test("CompleteOrderUseCase records order completion idempotently and emits once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const useCase = new CompleteOrderUseCase(repository, repository, repository);

  const first = await useCase.execute(completeOrderRequest());
  const second = await useCase.execute(completeOrderRequest());

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(repository.listOutbox("mrc_1").filter((event) => event.event_type === "order.completed").length, 1);
  const order = repository.getCompletedOrder("mrc_1", "chk_1", "ord_1");
  assert.equal(order?.trackingCode, undefined);
  const completed = repository.listOutbox("mrc_1").find((event) => event.event_type === "order.completed");
  assert.equal(completed?.payload.tracking_code, null);
});

test("CompleteOrderUseCase retains catalog variant identity for returns independently of SKU and selected options", async () => {
  const repository = new InMemoryCheckoutRepository();
  const session = checkoutSession();
  session.cart.items[0]!.variantId = "catalog-variant-50ml";
  session.cart.items[0]!.variant = JSON.stringify(["catalog-variant-50ml", ["extra"]]);
  repository.saveSession(session);
  const useCase = new CompleteOrderUseCase(repository, repository, repository);
  await useCase.execute(completeOrderRequest());
  const order = repository.getCompletedOrder("mrc_1", "chk_1", "ord_1");
  assert.equal(order?.lineItems?.[0]?.variantId, "catalog-variant-50ml");
  assert.equal(order?.lineItems?.[0]?.sku, session.cart.items[0]!.sku);
});

test("CompleteOrderUseCase commits order and outbox through the transaction boundary", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  let transactionCalls = 0;
  const txRunner = {
    async transaction<T>(work: (repo: typeof repository) => Promise<T>): Promise<T> {
      transactionCalls += 1;
      return work(repository);
    }
  };
  const useCase = new CompleteOrderUseCase(
    repository,
    repository,
    repository,
    undefined, // offerRepository
    undefined, // purchaseHistory
    undefined, // buyerAccounts
    undefined, // metrics
    txRunner as never
  );

  const first = await useCase.execute(completeOrderRequest());
  const second = await useCase.execute(completeOrderRequest());

  assert.equal(transactionCalls, 2);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(
    repository.listOutbox("mrc_1").filter((event) => event.event_type === "order.completed").length,
    1
  );
});

test("CompleteOrderUseCase emits WhatsApp tracking request when real tracking exists", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      customer: { phone: "11999998888" }
    })
  );
  const useCase = new CompleteOrderUseCase(repository, repository, repository);

  await useCase.execute(completeOrderRequest({ tracking_code: "BR123456789AA" }));

  const whatsapp = repository
    .listOutbox("mrc_1")
    .find((event) => event.event_type === "whatsapp.message.requested");
  assert.equal(whatsapp?.payload.tracking_code, "BR123456789AA");
  assert.equal(whatsapp?.payload.phone, "11999998888");
});

test("CompleteOrderUseCase records completed checkout into buyer purchase history once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      cart: {
        currency: "BRL",
        total: 200,
        currentDiscount: 20,
        items: [{ sku: "sku_1", name: "Running Shoe", price: 200, quantity: 1 }]
      }
    })
  );
  const purchaseHistory = new RecordingPurchaseHistoryPort();
  const useCase = new CompleteOrderUseCase(repository, repository, repository, undefined, purchaseHistory);

  await useCase.execute(completeOrderRequest({ order_total: 180, accepted_offer_id: "offer_1" }));
  await useCase.execute(completeOrderRequest({ order_total: 180, accepted_offer_id: "offer_1" }));

  assert.equal(purchaseHistory.records.length, 1);
  assert.equal(purchaseHistory.records[0]?.merchantId, "mrc_1");
  assert.equal(purchaseHistory.records[0]?.globalUserId, "usr_1");
  assert.equal(purchaseHistory.records[0]?.discountAmount, 20);
  assert.deepEqual(purchaseHistory.records[0]?.items.map((item) => item.title), ["Running Shoe"]);
});

test("CompleteOrderUseCase normalizes public BRL values before persisting internal attribution cents", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession({
    cart: {
      currency: "BRL",
      total: 112.5,
      currentDiscount: 12.5,
      items: [{ sku: "sku_1", name: "Produto", price: 112.5, quantity: 1 }],
    },
  }));
  const revenueLiftRepository = new RecordingRevenueLiftRepository();
  const useCase = new CompleteOrderUseCase(
    repository, repository, repository,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    new AttributionTaggerService(),
    undefined, undefined, undefined,
    revenueLiftRepository as never,
  );

  await useCase.execute(completeOrderRequest({ order_total: 100 }));
  await useCase.execute(completeOrderRequest({ order_total: 100 }));

  assert.equal(revenueLiftRepository.tags.length, 1);
  assert.equal(revenueLiftRepository.tags[0]?.orderValueCents, 10000);
  assert.equal(revenueLiftRepository.tags[0]?.discountGivenCents, 1250);
});

test("CompleteOrderUseCase feeds buyer purchase history so IA can read ticket médio", async () => {
  const checkoutRepository = new InMemoryCheckoutRepository();
  checkoutRepository.saveSession(
    checkoutSession({
      sessionId: "chk_1",
      globalUserId: "usr_global_1",
      cart: {
        currency: "BRL",
        total: 300,
        currentDiscount: 0,
        items: [{ sku: "sku_1", name: "First Item", price: 300, quantity: 1 }]
      }
    })
  );

  const purchaseHistoryRepository = new InMemoryBuyerPurchaseHistoryRepository();
  const recordPurchase = new RecordCompletedPurchaseUseCase(purchaseHistoryRepository);
  const purchaseHistoryPort = new BuyerPurchaseHistoryAdapter(recordPurchase);
  const completeOrder = new CompleteOrderUseCase(checkoutRepository, checkoutRepository, checkoutRepository, undefined, purchaseHistoryPort);
  const getContext = new GetBuyerPurchaseContextUseCase(purchaseHistoryRepository);

  await completeOrder.execute(
    completeOrderRequest({
      session_id: "chk_1",
      external_order_id: "ord_1",
      order_total: 300
    })
  );

  checkoutRepository.saveSession(
    checkoutSession({
      sessionId: "chk_2",
      globalUserId: "usr_global_1",
      cart: {
        currency: "BRL",
        total: 500,
        currentDiscount: 50,
        items: [{ sku: "sku_2", name: "Second Item", price: 500, quantity: 1 }]
      }
    })
  );

  await completeOrder.execute(
    completeOrderRequest({
      session_id: "chk_2",
      external_order_id: "ord_2",
      order_total: 450,
      currency: "BRL"
    })
  );

  const context = await getContext.execute({
    merchantId: "mrc_1",
    globalUserId: "usr_global_1"
  });

  assert.equal(context.purchase_history.orders_count, 2);
  assert.equal(context.purchase_history.lifetime_value, 750);
  assert.equal(context.purchase_history.average_order_value, 375);
  assert.equal(context.purchase_history.known_buyer, true);
});
