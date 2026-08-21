import type { ChatTurn, CheckoutEventName, CheckoutSession } from "@zyon/shared-types";

export const CHECKOUT_SESSION_REPOSITORY = Symbol("CHECKOUT_SESSION_REPOSITORY");

export type MaybePromise<T> = T | Promise<T>;

export interface CheckoutSessionRepository {
  saveSession(session: CheckoutSession): MaybePromise<void>;
  getSession(merchantId: string, sessionId: string): MaybePromise<CheckoutSession | undefined>;
  findSessionsByEmail(merchantId: string, email: string): MaybePromise<CheckoutSession[]>;
  appendChatTurn(merchantId: string, sessionId: string, turn: ChatTurn): MaybePromise<CheckoutSession>;
  recordEvent(merchantId: string, sessionId: string, event: CheckoutEventName): MaybePromise<void>;
  /**
   * Find sessions where triggerAgent=true and abandonmentScore >= threshold.
   * Used by Cart Recovery scanner to find sessions ready for intervention.
   */
  findSessionsWithTrigger(threshold?: number): MaybePromise<CheckoutSession[]>;
}
