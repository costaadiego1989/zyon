import type { OnboardingStateResponse, OnboardingStepId } from "../../../api-client.js";
import { friendlyError } from "../validation/schemas.js";

export interface UseStepReviewDeps {
  setMessage: (msg: string | null) => void;
  setBusy: (b: boolean) => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
  setOnboardingState: React.Dispatch<React.SetStateAction<OnboardingStateResponse | null>>;
  storageKey: string;
}

export function useStepReview(deps: UseStepReviewDeps) {
  async function finish() {
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      await deps.markOnboardingStep("checkout_config");
      await deps.markOnboardingStep("embed");
      await deps.markOnboardingStep("publish");
      localStorage.removeItem(deps.storageKey);
      deps.setOnboardingState((prev) => prev ? { ...prev, completed: true } : prev);
    } catch (e) {
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  return { finish };
}
