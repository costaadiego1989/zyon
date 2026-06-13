import { X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { brandInitials, CART_JOURNEY, resolveCartJourneyIndex } from "../../hooks/checkout-view-model.js";
import { TrustStrip } from "./TrustStrip.js";

export function CartHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const experience = vm.activeExperience;
  const trustBadges = [
    ...(vm.theme.trustBadges ?? []),
    ...(experience.copy.trust_badges ?? [])
  ]
    .filter(Boolean)
    .slice(0, 3);
  const orderRef = vm.session?.session_id?.slice(-6).toUpperCase() ?? "3EE8A6";
  const itemCount = vm.visibleItems.reduce((sum, item) => sum + item.quantity, 0);
  const journeyIndex = resolveCartJourneyIndex(vm.checkoutStage, itemCount);
  const journeyStep = CART_JOURNEY[journeyIndex] ?? CART_JOURNEY[0];
  const merchantInitials = brandInitials(experience.brand.name);
  const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);

  return (
    <header className="aacp-cart-header">
      <div className="aacp-cart-header-bar">
        <div className="aacp-cart-brand-lockup">
          <div className="aacp-cart-brand-mark" aria-hidden>
            {vm.theme.logoUrl ? (
              <img src={vm.theme.logoUrl} alt="" className="aacp-cart-brand-img" />
            ) : (
              merchantInitials
            )}
          </div>
          <div className="aacp-cart-brand-copy">
            <strong className="aacp-cart-store">{experience.brand.name}</strong>
            <span className="aacp-cart-order-badge">Pedido #{orderRef}</span>
          </div>
        </div>

        <div className="aacp-cart-header-actions">
          {isDev ? (
            <button
              type="button"
              className="aacp-debug-reset"
              onClick={() => {
                window.localStorage.removeItem("aacp_session_id");
                window.location.reload();
              }}
              title="Resetar sessão (dev)"
              aria-label="Resetar sessão de desenvolvimento"
            >
              Reset
            </button>
          ) : null}
          <button
            className="aacp-cart-close lg:hidden"
            onClick={() => vm.setCartOpen(false)}
            aria-label="Fechar"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="aacp-cart-header-status">
        <span className="aacp-cart-status-kicker">Agora</span>
        <span className="aacp-cart-status-label">{journeyStep.label}</span>
        <span className="aacp-cart-status-hint">{journeyStep.hint}</span>
      </div>

      <TrustStrip items={trustBadges} variant="inline" className="aacp-cart-trust" />
    </header>
  );
}
