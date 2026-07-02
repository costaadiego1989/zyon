import type { CheckoutExperienceSnapshot } from "@zyon/shared-types";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import { selectCheckoutExperiencePresentation } from "../presentation/checkout-experience-model.js";
import { ExperienceHeader } from "../features/shell/ExperienceHeader.js";
import { JourneyProtocol } from "../features/journey/JourneyProtocol.js";
import { DecisionStage } from "../features/conversation/DecisionStage.js";
import { CheckoutExperienceShell } from "../features/shell/CheckoutExperienceShell.js";
import { CheckoutExperienceOverlays } from "../features/shell/CheckoutExperienceOverlays.js";

export function ChatCheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  const presentation = selectCheckoutExperiencePresentation(vm);

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

      <CheckoutExperienceOverlays vm={vm} />
    </section>
  );
}

export type CheckoutExperienceSnapshotModel = CheckoutExperienceSnapshot;
