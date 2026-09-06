import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { PAYMENT_APPROVED_EVENT } from "../../checkout/domain/events/payment-approved.event.js";
import { createCheckoutEventEnvelope } from "../../checkout/domain/events/checkout-domain-event.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";

@Injectable()
export class CheckoutPaymentAdapter implements CheckoutPaymentPort {
  // Only used by direct in-memory fixtures; Nest requires PRISMA_CLIENT below.
  private readonly fixtureNotifications = new Map<string, Promise<void>>();
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient
  ) {}

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    await this.eventBus.publish({
      eventType: PAYMENT_APPROVED_EVENT,
      merchantId: input.merchantId,
      payload: {
        paymentIntentId: input.paymentIntentId,
        amountBreakdown: input.amountBreakdown,
        sessionId: input.sessionId,
        externalOrderId: input.externalOrderId,
        orderTotalMajorUnits: input.orderTotalMajorUnits,
        currency: input.currency,
        acceptedOfferId: input.acceptedOfferId
      }
    });
    await this.appendConfirmationOnce(input);
  }

  private async appendConfirmationOnce(input: CheckoutPaymentApprovedInput): Promise<void> {
    const receiptId = `payment_confirmation_${createHash("sha256").update(JSON.stringify([
      input.merchantId, input.sessionId, input.paymentIntentId ?? input.externalOrderId,
    ])).digest("hex")}`;
    const turn = {
      role: "agent",
      text: "Pagamento confirmado! Seu pedido foi registrado.",
      occurredAt: new Date().toISOString()
    } as const;
    if (!this.prisma) {
      const existing = this.fixtureNotifications.get(receiptId);
      if (existing) return existing;
      const pending = Promise.resolve(this.sessions.appendChatTurn(input.merchantId, input.sessionId, turn)).then(() => {});
      this.fixtureNotifications.set(receiptId, pending);
      try { await pending; } catch (error) { this.fixtureNotifications.delete(receiptId); throw error; }
      return;
    }
    await this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ chat_history: unknown }>>`
        SELECT chat_history FROM checkout_sessions
        WHERE merchant_id = ${input.merchantId} AND session_id = ${input.sessionId} FOR UPDATE`;
      if (!rows.length) throw new Error("checkout_session_not_found");
      if (await tx.checkoutEvent.findUnique({ where: { id: receiptId } })) return;
      const history = Array.isArray(rows[0].chat_history) ? rows[0].chat_history : [];
      await tx.checkoutEvent.create({ data: { id: receiptId, merchantId: input.merchantId,
        sessionId: input.sessionId, eventName: "payment_confirmation_notified", occurredAt: new Date(turn.occurredAt) } });
      await tx.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: input.merchantId, sessionId: input.sessionId } },
        data: { chatHistory: [...history, turn].slice(-50) as Prisma.InputJsonValue, updatedAt: new Date() } });
    });
  }

  async recordPaymentFailure({
    merchantId,
    sessionId,
    reason: _reason
  }: {
    merchantId: string;
    sessionId: string;
    reason: string;
  }): Promise<void> {
    void _reason;
    await this.sessions.recordEvent(merchantId, sessionId, "payment_failed");
    await this.sessions.appendChatTurn(merchantId, sessionId, {
      role: "agent",
      text: "Pagamento falhou. Voce pode tentar novamente por PIX ou escolher outra forma de pagamento segura.",
      occurredAt: new Date().toISOString()
    });
  }

  async recordPaymentStatusChanged({
    merchantId,
    sessionId,
    paymentIntentId,
    status,
    reason,
    commerceOrderId
  }: {
    merchantId: string;
    sessionId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    reason?: string;
    commerceOrderId?: string;
  }): Promise<void> {
    await this.outbox.appendOutbox(
      createCheckoutEventEnvelope({
        eventType: "payment.status.changed",
        merchantId,
        payload: {
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
          status,
          reason,
          commerce_order_id: commerceOrderId
        },
        causationId: paymentIntentId
      })
    );
  }
}
