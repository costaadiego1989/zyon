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
      // Final step: mark the AI engine step complete (whatsapp was marked when
      // leaving step 5). checkout_config is idempotent — safe to re-affirm.
      await deps.markOnboardingStep("checkout_config");
      await deps.markOnboardingStep("ai_engine");
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
