export const STRATEGY_REVIEW_EVENT = "zyon:review-strategy";
export const STRATEGY_CHANGED_EVENT = "zyon:strategy-changed";

export function strategyReviewHash(id: string) {
  return `revenue-manager?${new URLSearchParams({ strategy: id })}`;
}

export function strategyIdFromHash(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  const index = value.indexOf("?");
  if (index < 0 || value.slice(0, index) !== "revenue-manager") return null;
  const id = new URLSearchParams(value.slice(index + 1)).get("strategy");
  return id?.trim() && id.length <= 150 ? id : null;
}

export function openStrategyReview(hypothesisId: string) {
  window.dispatchEvent(new CustomEvent(STRATEGY_REVIEW_EVENT, { detail: { hypothesisId } }));
}

export function strategyChanged(hypothesisId: string) {
  window.dispatchEvent(new CustomEvent(STRATEGY_CHANGED_EVENT, { detail: { hypothesisId } }));
}
