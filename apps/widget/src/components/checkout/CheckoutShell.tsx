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
      className="relative min-h-[100vh] bg-[#07060d] bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(168,85,247,0.18),transparent_60%),radial-gradient(ellipse_60%_40%_at_100%_100%,rgba(99,102,241,0.12),transparent_60%),radial-gradient(ellipse_50%_40%_at_0%_80%,rgba(236,72,153,0.08),transparent_60%)] overflow-hidden flex items-center justify-center p-6"
      style={themeStyle(vm.theme)}
      data-cart-open={vm.cartOpen ? "true" : undefined}
    >
      <div className="relative w-full max-w-[1240px] h-[min(92vh,880px)] bg-gradient-to-b from-[#15121f]/85 to-[#0f0d1a]/90 backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-3xl overflow-hidden flex">
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <CheckoutHeader vm={vm} />
          <CheckoutStepper vm={vm} />
          <ChatThread vm={vm} />
          <Composer vm={vm} />
        </main>
        <CartPanel vm={vm} />
        <button
          type="button"
          className="lg:hidden fixed left-1/2 -translate-x-1/2 bottom-[max(16px,env(safe-area-inset-bottom))] z-[35] inline-flex items-center justify-center gap-2.5 min-h-[56px] min-w-[220px] rounded-full px-2 py-2 pr-5 text-white bg-gradient-to-br from-purple-500/30 to-white/5 bg-[#0c0a16]/95 border border-purple-500/40 shadow-[0_18px_54px_rgba(0,0,0,0.5),0_0_34px_rgba(168,85,247,0.2)] backdrop-blur-lg"
          onClick={() => vm.setCartOpen(true)}
          aria-expanded={vm.cartOpen}
          aria-controls="aacp-cart-panel"
          aria-label="Abrir resumo do pedido"
        >
          <span className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-[0_10px_24px_rgba(168,85,247,0.36)]" aria-hidden="true">
            <ShoppingBag size={18} />
          </span>
          <span className="grid gap-0.5 text-left">
            <strong className="text-[10px] font-black uppercase tracking-widest leading-none">Carrinho</strong>
            <em className="not-italic text-xs font-black text-purple-400 leading-none truncate">
              {vm.cartItemCount} {vm.cartItemCount === 1 ? "item" : "itens"} • {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}
            </em>
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30 transition-opacity duration-300",
            vm.cartOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo do pedido"
        />
      </div>
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
    </section>
  );
}

export type CheckoutShellExperience = CheckoutExperienceSnapshot;
