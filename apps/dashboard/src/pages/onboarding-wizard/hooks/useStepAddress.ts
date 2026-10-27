import type { OnboardingStepId } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import { friendlyError } from "../validation/schemas.js";
import type { AddressDraft } from "../types.js";

export interface UseStepAddressDeps {
  addressDraft: AddressDraft;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMessage: (msg: string | null) => void;
  setBusy: (b: boolean) => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
}

export function useStepAddress(deps: UseStepAddressDeps) {
  const api = useApi();

  async function saveStep2() {
    if (!deps.addressDraft.zip || deps.addressDraft.zip.replace(/\D/g, "").length < 8) {
      deps.setFieldErrors({ zip: "CEP obrigatório (8 dígitos)" });
      return;
    }
    deps.setFieldErrors({});
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      await api.putStoreSettings({
        company: {
          address: {
            street: deps.addressDraft.street,
            number: deps.addressDraft.number,
            complement: deps.addressDraft.complement,
            neighborhood: deps.addressDraft.neighborhood,
            city: deps.addressDraft.city,
            state: deps.addressDraft.state,
            zip: deps.addressDraft.zip,
          },
        },
      });
      try { await api.putMerchantRules({ originZip: deps.addressDraft.zip.replace(/\D/g, "") }); } catch (err) {
        reportError({ source: "onboarding.saveStep2.putMerchantRules", error: err, severity: "warning" });
      }
      await deps.markOnboardingStep("checkout_config");
      deps.setCurrentStep(3);
    } catch (e) {
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  return { saveStep2 };
}
