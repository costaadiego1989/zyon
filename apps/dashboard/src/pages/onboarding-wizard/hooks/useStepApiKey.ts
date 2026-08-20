import type { OnboardingStepId } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { friendlyError } from "../validation/schemas.js";

export interface UseStepApiKeyDeps {
  setGeneratedApiKey: React.Dispatch<React.SetStateAction<{ id: string; secretKey: string; name: string } | null>>;
  setMessage: (msg: string | null) => void;
  setBusy: (b: boolean) => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
}

export function useStepApiKey(deps: UseStepApiKeyDeps) {
  const api = useApi();

  async function generateApiKey() {
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      const result = await api.createIntegrationApiKey({
        name: "Onboarding key",
        scopes: ["checkout:read", "checkout:write", "configuration:read", "embed:sessions:create", "orders:read", "catalog:read", "commerce:read"],
      });
      deps.setGeneratedApiKey({ id: result.api_key.id, secretKey: result.secret_key, name: result.api_key.name });
      await deps.markOnboardingStep("embed");
    } catch (e) {
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  return { generateApiKey };
}
