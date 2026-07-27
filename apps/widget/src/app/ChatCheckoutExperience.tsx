import type { CheckoutExperienceSnapshot } from "@zyon/shared-types";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import { selectCheckoutExperiencePresentation } from "../presentation/checkout-experience-model.js";
import { ExperienceHeader } from "../features/shell/ExperienceHeader.js";
import { JourneyProtocol } from "../features/journey/JourneyProtocol.js";
import { DecisionStage } from "../features/conversation/DecisionStage.js";
import { CheckoutExperienceShell } from "../features/shell/CheckoutExperienceShell.js";
import { CheckoutExperienceOverlays } from "../features/shell/CheckoutExperienceOverlays.js";

export function ChatCheckoutExperience({
  vm,
  privacyUrl,
}: {
  vm: CheckoutAgentViewModel;
  privacyUrl?: string;
}) {
  const presentation = selectCheckoutExperiencePresentation(vm);
  const effectivePrivacyUrl = privacyUrl ?? vm.activeExperience.policies?.privacyUrl;

  return (
    <section
      className="checkout-experience zyon-page zyon-widget zyon-widget--conversational"
      style={presentation.style}
      data-cart-open={vm.cartOpen ? "true" : undefined}
      data-color-mode={presentation.colorMode}
      data-theme={presentation.colorMode}
      data-stage={presentation.stage}
      data-channel="chat"
      data-skin="pulse"
    >
      <div className="zyon-shell">
        <main className="zyon-main">
          <ExperienceHeader model={presentation.header} />
          <JourneyProtocol model={presentation.journey} />
          <DecisionStage vm={vm} />
        </main>

        <CheckoutExperienceShell vm={vm} />
      </div>

      {effectivePrivacyUrl ? (
        <a
          href={effectivePrivacyUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            position: "absolute",
            right: 14,
            bottom: 10,
            fontSize: "10.5px",
            color: "var(--aacp-muted, #64748b)",
            textDecoration: "none",
          }}
        >
          Política de Privacidade
        </a>
      ) : null}

      <CheckoutExperienceOverlays vm={vm} />
    </section>
  );
}

export type CheckoutExperienceSnapshotModel = CheckoutExperienceSnapshot;
