export const STRATEGY_REVIEW_EVENT = "zyon:review-strategy";
export const STRATEGY_CHANGED_EVENT = "zyon:strategy-changed";

export function openStrategyReview(hypothesisId: string) {
  window.dispatchEvent(new CustomEvent(STRATEGY_REVIEW_EVENT, { detail: { hypothesisId } }));
}

export function strategyChanged(hypothesisId: string) {
  window.dispatchEvent(new CustomEvent(STRATEGY_CHANGED_EVENT, { detail: { hypothesisId } }));
}
