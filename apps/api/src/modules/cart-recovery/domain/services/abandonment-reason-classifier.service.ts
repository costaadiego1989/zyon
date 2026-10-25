import type { AbandonmentReason } from "../values/abandonment-reason.js";

/**
 * Classifies a session's abandonment reason from its event log.
 * Pure function — no I/O, no LLM. Uses LAST relevant event.
 */
export class AbandonmentReasonClassifier {
  private static readonly EVENT_TO_REASON: Record<string, AbandonmentReason> = {
    shipping_objection_detected: "shipping_cost",
    coupon_field_clicked: "price",
    payment_failed: "payment",
    trust_objection_detected: "trust",
  };

  static classify(events: string[]): AbandonmentReason {
    if (!events || events.length === 0) {
      return "unknown";
    }

    // Walk events from last to first; return the first mapped reason found
    for (let i = events.length - 1; i >= 0; i--) {
      const reason = this.EVENT_TO_REASON[events[i]!];
      if (reason) {
        return reason;
      }
    }

    // Check for hesitation pattern: exit_intent or idle in recent events
    // `checkout_abandoned` is the terminal browser lifecycle signal emitted
    // when a buyer closes or leaves the checkout. It is as actionable as the
    // softer idle/exit-intent signals; treating it as unknown otherwise sends
    // a sub-0.7 score into the 60-minute wait-and-retry branch rather than
    // the configured cart-recovery flow.
    const hesitationSignals = ["checkout_abandoned", "exit_intent_detected", "idle_30s", "idle_30_seconds"];
    const hasHesitation = events.some((e) => hesitationSignals.includes(e));
    if (hasHesitation) {
      return "hesitation";
    }

    return "unknown";
  }
}
