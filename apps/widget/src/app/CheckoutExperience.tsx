import type { CheckoutExperienceSnapshot } from "@aacp/shared-types";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import { cn } from "../hooks/checkout-view-model.js";
import { selectCheckoutExperiencePresentation } from "../presentation/checkout-experience-model.js";
import { ExperienceHeader } from "../features/shell/ExperienceHeader.js";
import { JourneyProtocol } from "../features/journey/JourneyProtocol.js";
import { BuyerGuestModal } from "../components/checkout/BuyerGuestModal.js";
import { CartFAB } from "../components/checkout/CartFAB.js";
import { CartPanel } from "../components/checkout/CartPanel.js";
import { ChatThread } from "../components/checkout/ChatThread.js";
import { FloatingCheckout } from "../components/checkout/FloatingCheckout.js";
import { GlobalAuthModal } from "../components/checkout/GlobalAuthModal.js";
import { SupportPanel } from "../components/checkout/SupportPanel.js";
import { ThemeStudio } from "../components/checkout/ThemeStudio.js";
import { UserPanel } from "../components/checkout/UserPanel.js";

export function CheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.isConversational) return <FloatingCheckout vm={vm} />;

  const presentation = selectCheckoutExperiencePresentation(vm);

  return (
    <section
      className="checkout-experience aacp-page aacp-widget aacp-widget--conversational"
      style={presentation.style}
      data-cart-open={vm.cartOpen ? "true" : undefined}
      data-color-mode={presentation.colorMode}
      data-theme={presentation.colorMode}
      data-stage={presentation.stage}
    >
      <div className="aacp-shell">
        <main className="aacp-main">
          <ExperienceHeader model={presentation.header} />
          <JourneyProtocol model={presentation.journey} />
          <ChatThread vm={vm} />
        </main>

        <CartPanel vm={vm} />
        <UserPanel vm={vm} />

        <div
          className={cn("aacp-cart-overlay", vm.cartOpen ? "open" : "")}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo do pedido"
        />
      </div>

      <SupportPanel vm={vm} />
      <CartFAB vm={vm} />
      <ThemeStudio studio={vm.themeStudio} theme={vm.theme} />
      <BuyerGuestModal vm={vm} />
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
    </section>
  );
}

export type CheckoutExperienceSnapshotModel = CheckoutExperienceSnapshot;
