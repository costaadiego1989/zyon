import type { CheckoutExperienceSnapshot } from "@aacp/shared-types";
import { GlobalAuthModal } from "./GlobalAuthModal.js";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, themeStyle } from "../../hooks/checkout-view-model.js";
import { CheckoutHeader } from "./CheckoutHeader.js";
import { CheckoutStepper } from "./CheckoutStepper.js";
import { ChatThread } from "./ChatThread.js";
import { CartPanel } from "./CartPanel.js";
import { UserPanel } from "../checkout/UserPanel.js";
import { SupportFAB } from "./SupportFAB.js";
import { SupportPanel } from "./SupportPanel.js";
import { CartFAB } from "./CartFAB.js";
import { FloatingCheckout } from "./FloatingCheckout.js";

export function CheckoutShell({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.isConversational) return <FloatingCheckout vm={vm} />;

  return (
    <section
      className="aacp-page aacp-widget aacp-widget--conversational"
      style={themeStyle(vm.theme, true)}
      data-cart-open={vm.cartOpen ? "true" : undefined}
      data-color-mode={vm.colorMode}
      data-theme={vm.colorMode}
    >
      <div className="aacp-shell">
        <main className="aacp-main">
          <CheckoutHeader vm={vm} />
          <CheckoutStepper vm={vm} />
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

      <SupportFAB vm={vm} />
      <SupportPanel vm={vm} />
      <CartFAB vm={vm} />
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
    </section>
  );
}

export type CheckoutShellExperience = CheckoutExperienceSnapshot;
