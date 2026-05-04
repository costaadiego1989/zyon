import type { Cart, ChatTurn, CheckoutSession, CustomerHints, ShippingQuote } from "@aacp/shared-types";
import { CHECKOUT_TRIGGER_THRESHOLD } from "../services/checkout-abandonment.service.js";

const CHAT_HISTORY_LIMIT = 50;

export class CheckoutSessionEntity {
  private constructor(private readonly props: CheckoutSession) {}

  static create(input: {
    merchantId: string;
    sessionId: string;
    globalUserId: string;
    conversationId: string;
    cart: Cart;
    customer?: CustomerHints;
    shipping?: ShippingQuote;
  }): CheckoutSessionEntity {
    const now = new Date().toISOString();
    return new CheckoutSessionEntity({
      merchantId: input.merchantId,
      sessionId: input.sessionId,
      globalUserId: input.globalUserId,
      conversationId: input.conversationId,
      cart: input.cart,
      customer: input.customer,
      shipping: input.shipping,
      abandonmentScore: 0,
      triggerAgent: false,
      chatHistory: [],
      createdAt: now,
      updatedAt: now
    });
  }

  static rehydrate(snapshot: CheckoutSession): CheckoutSessionEntity {
    return new CheckoutSessionEntity({
      ...snapshot,
      chatHistory: snapshot.chatHistory ?? []
    });
  }

  updateScore(score: number): CheckoutSessionEntity {
    return new CheckoutSessionEntity({
      ...this.props,
      abandonmentScore: score,
      triggerAgent: score >= CHECKOUT_TRIGGER_THRESHOLD,
      updatedAt: new Date().toISOString()
    });
  }

  appendTurn(turn: ChatTurn): CheckoutSessionEntity {
    const next = [...this.props.chatHistory, turn].slice(-CHAT_HISTORY_LIMIT);
    return new CheckoutSessionEntity({
      ...this.props,
      chatHistory: next,
      updatedAt: new Date().toISOString()
    });
  }

  snapshot(): CheckoutSession {
    return { ...this.props, chatHistory: [...this.props.chatHistory] };
  }
}
