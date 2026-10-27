import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { CreatePaymentIntentUseCase as AuthoritativeCreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { CheckoutSessionRepository } from "../domain/ports/checkout-session.repository.port.js";
import type { EmailSenderPort, SendEmailInput, SendEmailOutput } from "../../notifications/domain/ports/email-sender.port.js";

/** Test-only, ordinary native-catalog purchase. All readers enforce the requested
 * persisted tenant/session and aggregate stock through the real runtime guard.
 * Does not simulate Prisma transactions, reservations or durable persistence. */
export function purchaseFlowAuthority(checkout: CheckoutSessionRepository): PrismaClient {
  let scope: { merchantId: string; sessionId: string } | undefined;
  return {
    checkoutSession: {
      async findUnique(input: { where: { merchantId_sessionId: { merchantId: string; sessionId: string } } }) {
        scope = input.where.merchantId_sessionId;
        assert.ok(scope.merchantId && scope.sessionId);
        const stored = await checkout.getSession(scope.merchantId, scope.sessionId);
        assert.ok(stored, "authority must read the persisted checkout");
        assert.equal(stored.merchantId, scope.merchantId);
        assert.equal(stored.sessionId, scope.sessionId);
        return stored;
      },
    },
    crossStoreLineItem: {
      async findFirst(input: { where: { hostMerchantId: string; checkoutSessionId: { in: string[] } } }) {
        assert.ok(scope);
        assert.equal(input.where.hostMerchantId, scope.merchantId);
        assert.ok(input.where.checkoutSessionId.in.includes(scope.sessionId));
        return null; // These scenarios explicitly contain no federated lines.
      },
    },
    productVariant: {
      async findMany(input: { where: { product: { merchantId: string }; OR: [{ id: { in: string[] } }, { sku: { in: string[] } }] }; include: { product: boolean; stock: boolean } }) {
        assert.ok(scope);
        assert.equal(input.where.product.merchantId, scope.merchantId);
        assert.deepEqual(input.include, { product: true, stock: true });
        const stored = await checkout.getSession(scope.merchantId, scope.sessionId);
        assert.ok(stored);
        assert.deepEqual(input.where.OR[1].sku.in, stored.cart.items.map(item => item.sku));
        return [...new Map(stored.cart.items.map(item => [item.sku, item])).values()].map(item => ({
          id: item.variantId ?? `variant_${item.sku}`, sku: item.sku, isActive: true,
          product: { merchantId: scope!.merchantId, isActive: true, deletedAt: null, type: "physical" },
          stock: [{ quantity: 100, reserved: 0 }],
        }));
      },
    },
  } as unknown as PrismaClient;
}

export class CheckoutPurchasePaymentIntent extends AuthoritativeCreatePaymentIntentUseCase {
  constructor(...args: ConstructorParameters<typeof AuthoritativeCreatePaymentIntentUseCase>) {
    args[12] ??= purchaseFlowAuthority(args[0]);
    super(...args);
  }
}

export class RecordingCheckoutEmailSender implements EmailSenderPort {
  readonly deliveries: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    assert.equal(input.requireDelivery, true);
    assert.ok(input.merchantId);
    assert.match(input.idempotencyKey ?? "", /^checkout-otp:/);
    this.deliveries.push(input);
    return { status: "sent", messageId: `synthetic-delivery-${this.deliveries.length}` };
  }
}

