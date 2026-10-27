import { useState } from "react";
import type { OnboardingStepId } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import { validateThemeDraft, friendlyError } from "../validation/schemas.js";
import type { ThemeDraft } from "../types.js";

export interface UseStepIdentityDeps {
  themeDraft: ThemeDraft;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMessage: (msg: string | null) => void;
  setBusy: (b: boolean) => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
}

export function useStepIdentity(deps: UseStepIdentityDeps) {
  const api = useApi();

  async function saveStep1() {
    const errors = validateThemeDraft(deps.themeDraft);
    if (errors.length > 0) {
      deps.setFieldErrors(Object.fromEntries(
        errors
          .filter((e): e is { valid: false; field: string; message: string } => !e.valid)
          .map((e) => [e.field, e.message]),
      ));
      return;
    }
    deps.setFieldErrors({});
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      let current: Record<string, unknown> = {};
      try { current = (await api.getMerchantTheme()) as unknown as Record<string, unknown>; } catch (err) {
        reportError({ source: "onboarding.saveStep1.fetchTheme", error: err, severity: "warning" });
      }
      const { originZip, storeCategory, secondaryColor, headingFont, bodyFont, ...themeFields } = deps.themeDraft;

      let finalLogoUrl = themeFields.logoUrl;
      if (finalLogoUrl && finalLogoUrl.startsWith("data:")) {
        try {
          const { logoUrl } = await api.uploadLogo(finalLogoUrl);
          finalLogoUrl = logoUrl;
        } catch (err) {
          reportError({ source: "onboarding.saveStep1.uploadLogo", error: err, severity: "warning" });
        }
      }

      const payload = { ...current, ...themeFields, logoUrl: finalLogoUrl, secondaryColor, fontDisplay: headingFont, fontFamily: bodyFont } as Parameters<typeof api.putMerchantTheme>[0];
      await api.putMerchantTheme(payload);
      if (originZip) {
        try { await api.putMerchantRules({ originZip }); } catch (err) {
          reportError({ source: "onboarding.saveStep1.putMerchantRules", error: err, severity: "warning" });
        }
      }
      if (storeCategory) {
        try { await api.putStoreCategory(storeCategory); } catch (err) {
          reportError({ source: "onboarding.saveStep1.putStoreCategory", error: err, severity: "warning" });
        }
      }
      await deps.markOnboardingStep("account");
      deps.setCurrentStep(2);
    } catch (e) {
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  return { saveStep1 };
}
