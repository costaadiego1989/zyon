import { ShoppingBag } from "lucide-react";
import type { CheckoutExperienceSnapshot } from "@aacp/shared-types";
import { GlobalAuthModal } from "../global-auth-modal.js";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency, themeStyle } from "../../hooks/checkout-view-model.js";

import { CheckoutHeader } from "./CheckoutHeader.js";
import { CheckoutStepper } from "./CheckoutStepper.js";
import { ChatThread } from "./ChatThread.js";
import { Composer } from "./Composer.js";
import { CartPanel } from "./CartPanel.js";
import { FloatingCheckout } from "./FloatingCheckout.js";

export function CheckoutShell({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.isConversational) return <FloatingCheckout vm={vm} />;

  return (
    <section
      className="aacp-widget aacp-widget--conversational aacp-page"
      style={themeStyle(vm.theme)}
      data-cart-open={vm.cartOpen ? "true" : undefined}
    >
      <div className="aacp-shell">
        <main className="aacp-main">
          <CheckoutHeader vm={vm} />
          <CheckoutStepper vm={vm} />
          <ChatThread vm={vm} />
          <Composer vm={vm} />
        </main>
        <CartPanel vm={vm} />
        <button
          type="button"
          className="aacp-mobile-cart-fab"
          onClick={() => vm.setCartOpen(true)}
          aria-expanded={vm.cartOpen}
          aria-controls="aacp-cart-panel"
          aria-label="Abrir resumo do pedido"
        >
          <span className="aacp-mobile-cart-icon" aria-hidden="true">
            <ShoppingBag size={18} />
          </span>
          <span>
            <strong>Carrinho</strong>
            <em>{vm.cartItemCount} iten{vm.cartItemCount === 1 ? "" : "s"} • {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</em>
          </span>
        </button>
        <button
          type="button"
          className={cn("aacp-backdrop", vm.cartOpen && "open")}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo do pedido"
        />
      </div>
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
    </section>
  );
}

export type CheckoutShellExperience = CheckoutExperienceSnapshot;
