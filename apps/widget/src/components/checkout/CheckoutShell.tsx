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

  const isDark = vm.colorMode === "dark";

  return (
    <section
      className={cn(
        "relative min-h-[100vh] flex items-center justify-center p-4 sm:p-6 transition-colors duration-300 aacp-widget aacp-widget--conversational",
        isDark ? "bg-[#0c0a16]" : "bg-gradient-to-br from-slate-50 via-white to-purple-50/30"
      )}
      style={themeStyle(vm.theme)}
      data-cart-open={vm.cartOpen ? "true" : undefined}
      data-color-mode={vm.colorMode}
    >
      <div className={cn(
        "relative w-full max-w-[1240px] h-[min(94vh,880px)] border rounded-[32px] overflow-hidden flex shadow-2xl transition-colors duration-300",
        isDark
          ? "bg-[#0c0a16] border-white/10"
          : "bg-white border-slate-200/80 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.08)]"
      )}>
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <CheckoutHeader vm={vm} />
          <CheckoutStepper vm={vm} />
          <ChatThread vm={vm} />
          <Composer vm={vm} />
        </main>
        <CartPanel vm={vm} />
        <button
          type="button"
          className={cn(
            "lg:hidden fixed left-1/2 -translate-x-1/2 bottom-[max(16px,env(safe-area-inset-bottom))] z-[35] inline-flex items-center justify-center gap-2.5 min-h-[56px] min-w-[220px] rounded-full px-2 py-2 pr-5 border backdrop-blur-lg",
            isDark
              ? "text-white bg-gradient-to-br from-purple-500/30 to-white/5 bg-[#0c0a16]/95 border-purple-500/40 shadow-[0_18px_54px_rgba(0,0,0,0.5),0_0_34px_rgba(168,85,247,0.2)]"
              : "text-slate-800 bg-white/95 border-purple-200 shadow-[0_10px_30px_rgba(0,0,0,0.08)]"
          )}
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
            <em className={cn("not-italic text-xs font-black leading-none truncate", isDark ? "text-purple-400" : "text-purple-600")}>
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
