import { dashboardJson } from "../http/client.js";
import type {
  OnboardingStateResponse,
  OnboardingStepId,
  EmbedSessionResponse,
} from "../types.js";

export function onboardingEndpoints(base: string, f: typeof fetch) {
  return {
    getOnboardingState(): Promise<OnboardingStateResponse> {
      return dashboardJson(base, "/onboarding", { method: "GET" }, f);
    },
    completeOnboardingStep(step: OnboardingStepId): Promise<OnboardingStateResponse> {
      return dashboardJson(
        base,
        `/onboarding/steps/${encodeURIComponent(step)}/complete`,
        { method: "POST" },
        f
      );
    },

    // Embed session
    createEmbedSession(payload: {
      ttl_seconds?: number;
      allowed_origin?: string;
      scopes?: string[];
      cart_ref?: string;
    }): Promise<EmbedSessionResponse> {
      return dashboardJson(base, "/embed/sessions", { method: "POST", jsonBody: payload }, f);
    },
  };
}