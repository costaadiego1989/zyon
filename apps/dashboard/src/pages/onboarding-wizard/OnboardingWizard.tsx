import React from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useOnboardingWizard } from "./useOnboardingWizard.js";
import { StepRail } from "./components/StepRail.js";
import { StepFooter } from "./components/StepFooter.js";
import { LivePreview } from "./components/LivePreview.js";
import { CompletedView } from "./steps/CompletedView.js";
import { PlanSelection } from "./steps/PlanSelection.js";
import { StepIdentity } from "./steps/StepIdentity.js";
import { StepAddress } from "./steps/StepAddress.js";
import { StepPayment } from "./steps/StepPayment.js";
import { StepWhatsApp } from "./steps/StepWhatsApp.js";
import { StepAiEngine } from "./steps/StepAiEngine.js";
import "./onboarding-wizard.css";

export interface OnboardingWizardProps {
  apiBaseUrl: string;
  me: MerchantProfile;
  onNavigate: (tab: "settings" | "rules" | "theme" | "embed") => void;
  onFinished: () => void;
}

export function OnboardingWizard(props: OnboardingWizardProps) {
  const vm = useOnboardingWizard(props);
  const [planChosen, setPlanChosen] = React.useState(false);

  if (!vm.onboardingState) {
    return (
      <div className="onb-loading" role="status" aria-live="polite">
        <span className="onb-loading-dot" aria-hidden="true" />
        {vm.message ?? "Preparando sua configuração..."}
      </div>
    );
  }

  if (vm.onboardingState.completed) {
    if (!planChosen) {
      return (
        <PlanSelection
          merchantName={vm.me.name}
          merchantEmail={(vm.me as { email?: string }).email}
          onDone={() => setPlanChosen(true)}
        />
      );
    }
    return <CompletedView name={vm.me.name} onFinished={vm.onFinished} />;
  }

  const handleNext = () => {
    if (vm.currentStep === 1) void vm.saveStep1();
    else if (vm.currentStep === 2) void vm.saveStep2();
    else if (vm.currentStep === 3) void vm.saveStep3();
    else if (vm.currentStep === 4) void vm.completeWhatsAppStep();
    else void vm.finish();
  };

  return (
    <div className="onb">
      <div className="onb-main">
        <StepRail
          steps={vm.steps}
          currentStep={vm.currentStep}
          progress={Math.round(((vm.currentStep - 1) / Math.max(1, vm.totalSteps - 1)) * 100)}
        />

        <section className="onb-stage">
          <div className="onb-stage-content">
            <header className="onb-stage-header">
              <h2 className="onb-stage-title">{vm.activeMeta?.label}</h2>
              <p className="onb-stage-caption">{vm.activeMeta?.caption}</p>
            </header>

            {vm.message && (
              <div className="onb-message" role="alert">{vm.message}</div>
            )}

            <div className="onb-stage-body">
              {vm.currentStep === 1 && (
                <StepIdentity
                  themeDraft={vm.themeDraft}
                  setThemeDraft={vm.setThemeDraft}
                  fieldErrors={vm.fieldErrors}
                  FONT_OPTIONS={vm.FONT_OPTIONS}
                  STORE_CATEGORIES={vm.STORE_CATEGORIES}
                  me={vm.me}
                />
              )}

              {vm.currentStep === 2 && (
                <StepAddress
                  addressDraft={vm.addressDraft}
                  setAddressDraft={vm.setAddressDraft}
                  fieldErrors={vm.fieldErrors}
                />
              )}

              {vm.currentStep === 3 && (
                <StepPayment
                  paymentDraft={vm.paymentDraft}
                  setPaymentDraft={vm.setPaymentDraft}
                  fieldErrors={vm.fieldErrors}
                  setFieldErrors={vm.setFieldErrors}
                  busy={vm.busy}
                  initiateStripeOnboarding={vm.initiateStripeOnboarding}
                  initiateAsaasOnboarding={vm.initiateAsaasOnboarding}
                  initiateMercadoPagoOnboarding={vm.initiateMercadoPagoOnboarding}
                />
              )}

              {vm.currentStep === 4 && <StepWhatsApp me={vm.me} />}

              {vm.currentStep === 5 && <StepAiEngine />}
            </div>
          </div>

          <StepFooter
            currentStep={vm.currentStep}
            totalSteps={vm.totalSteps}
            busy={vm.busy}
            onBack={vm.goBack}
            onNext={handleNext}
          />
          <span className="onb-stage-index" aria-hidden="true">{vm.activeMeta?.label}</span>
        </section>

        <LivePreview apiBaseUrl={vm.apiBaseUrl} me={vm.me} themeDraft={vm.themeDraft} />
      </div>
    </div>
  );
}
