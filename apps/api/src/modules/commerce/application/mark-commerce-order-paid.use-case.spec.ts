import test from "node:test";
import assert from "node:assert/strict";
import type { CommerceOrderPort } from "@aacp/commerce-adapters";
import { InMemoryCommercePaidWebhookDedup } from "../infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import { MarkCommerceOrderPaidUseCase } from "./mark-commerce-order-paid.use-case.js";

test("first paid notification invokes commerce sync exactly once", async () => {
  let markPaidCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "unexpected" };
    },
    async markOrderPaid(args) {
      markPaidCalls += 1;
      assert.equal(args.merchantId, "m1");
      assert.equal(args.commerceOrderId, "ord_shop_1");
      assert.equal(args.paymentReference, "pay_ref_a");
    }
  };
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const uc = new MarkCommerceOrderPaidUseCase(orders, dedup);

  const first = await uc.execute({
    merchantId: "m1",
    commerceOrderId: "ord_shop_1",
    paymentReference: "pay_ref_a"
  });
  const second = await uc.execute({
    merchantId: "m1",
    commerceOrderId: "ord_shop_1",
    paymentReference: "pay_ref_a"
  });

  assert.equal(first.invokedCommerceSync, true);
  assert.equal(second.invokedCommerceSync, false);
  assert.equal(markPaidCalls, 1);
});

test("distinct payment references each trigger commerce sync for same order", async () => {
  let markPaidCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "x" };
    },
    async markOrderPaid() {
      markPaidCalls += 1;
    }
  };
  const uc = new MarkCommerceOrderPaidUseCase(orders, new InMemoryCommercePaidWebhookDedup());

  await uc.execute({
    merchantId: "m1",
    commerceOrderId: "ord_shop_1",
    paymentReference: "pay_1"
  });
  await uc.execute({
    merchantId: "m1",
    commerceOrderId: "ord_shop_1",
    paymentReference: "pay_2"
  });

  assert.equal(markPaidCalls, 2);
});

test("same payment reference isolated per merchant", async () => {
  let markPaidCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "x" };
    },
    async markOrderPaid() {
      markPaidCalls += 1;
    }
  };
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const uc = new MarkCommerceOrderPaidUseCase(orders, dedup);

  const a = await uc.execute({
    merchantId: "merchant_a",
    commerceOrderId: "o_a",
    paymentReference: "shared_ref"
  });
  const b = await uc.execute({
    merchantId: "merchant_b",
    commerceOrderId: "o_b",
    paymentReference: "shared_ref"
  });

  assert.equal(a.invokedCommerceSync, true);
  assert.equal(b.invokedCommerceSync, true);
  assert.equal(markPaidCalls, 2);
});

test("propagates errors from commerce markOrderPaid without marking dedup processed", async () => {
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "x" };
    },
    async markOrderPaid() {
      throw new Error("shopify_graphql_failed");
    }
  };
  const dedup = new InMemoryCommercePaidWebhookDedup();
  const uc = new MarkCommerceOrderPaidUseCase(orders, dedup);

  await assert.rejects(
    () =>
      uc.execute({
        merchantId: "m1",
        commerceOrderId: "ord_1",
        paymentReference: "pay_retryable"
      }),
    /shopify_graphql_failed/
  );

  assert.equal(await dedup.isProcessed("m1", "pay_retryable"), false);

  let markPaidCalls = 0;
  const succeeding: CommerceOrderPort = {
    async createPendingOrder() {
      return { commerceOrderId: "x" };
    },
    async markOrderPaid() {
      markPaidCalls += 1;
    }
  };
  const uc2 = new MarkCommerceOrderPaidUseCase(succeeding, dedup);
  await uc2.execute({
    merchantId: "m1",
    commerceOrderId: "ord_1",
    paymentReference: "pay_retryable"
  });

  assert.equal(markPaidCalls, 1);
});
