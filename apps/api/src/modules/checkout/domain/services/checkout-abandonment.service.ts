import { scoreEvent } from "@aacp/decision-engine";
import type { CheckoutEventName } from "@aacp/shared-types";

export const CHECKOUT_TRIGGER_THRESHOLD = 0.55;

export interface CheckoutScoreChange {
  previousScore: number;
  nextScore: number;
  triggerAgent: boolean;
  changed: boolean;
}

export class CheckoutAbandonmentService {
  static applyEvent(previousScore: number, event: CheckoutEventName): CheckoutScoreChange {
    const nextScore = scoreEvent(previousScore, event);
    return {
      previousScore,
      nextScore,
      triggerAgent: nextScore >= CHECKOUT_TRIGGER_THRESHOLD,
      changed: nextScore !== previousScore
    };
  }
}
