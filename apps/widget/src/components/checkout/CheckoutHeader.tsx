import { LogIn, Moon, ShoppingBag, Sparkles, Sun } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, formatCurrency } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.theme.agentName || vm.activeExperience.agent.name);
  const headerTitle = vm.theme.headerTitle?.trim() || agentName.given;
  const headerSubtitle =
    vm.theme.headerSubtitle?.trim() ||
    `${vm.activeExperience.brand.name} - online - responde em segundos`;
  const trustBadges = (vm.theme.trustBadges ?? []).filter(Boolean).slice(0, 3);
  const isDark = vm.colorMode === "dark";
  const openAccount = () => {
    if (vm.auth.session?.global_user_id) {
      vm.setUserPanelOpen(true);
      return;
    }
    vm.auth.openHub();
  };

  return (
    <header className="aacp-header aacp-shell-header">
      <div className="aacp-header-left">
        <div className="aacp-avatar" aria-hidden="true">
          {vm.theme.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
          ) : (
            <Sparkles size={20} />
          )}
          <span className="aacp-status-dot" />
        </div>
        <div className="aacp-header-copy">
          <div className="aacp-agent-name">
            {headerTitle} <span className="sep">·</span>{" "}
            <span className="role">{agentName.rest || "Assistente de Vendas"}</span>
          </div>
          <div className="aacp-agent-sub">
            <span className="live-dot" />
            {headerSubtitle}
          </div>
          {trustBadges.length ? (
            <div className="aacp-header-badges" aria-label="Selos do checkout">
              {trustBadges.map((badge) => (
                <span key={badge} className="aacp-header-badge">{badge}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="aacp-header-actions">
        <button
          className="aacp-icon-btn"
          onClick={vm.toggleColorMode}
          aria-label={isDark ? "Modo claro" : "Modo escuro"}
          title={isDark ? "Modo claro" : "Modo escuro"}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {vm.auth.session ? (
          <button className="aacp-user-chip" onClick={openAccount} aria-label="Minha conta">
            <span className="aacp-user-avatar">
              {(vm.auth.session.email?.[0] ?? "C").toUpperCase()}
            </span>
            <span className="aacp-user-chip-name">Minha conta</span>
          </button>
        ) : vm.activeExperience?.customer?.email_verified ? (
          <button id="aacp-login-btn" className="aacp-user-chip" onClick={() => vm.setUserPanelOpen(true)} aria-label="Abrir conta">
            <span className="aacp-user-avatar">
              {(vm.activeExperience?.customer?.fullName || "C")[0]}
            </span>
            <span className="aacp-user-chip-name">
              Olá, {vm.activeExperience?.customer?.fullName?.split(" ")[0]}
              <span className="aacp-user-chip-sub"> · Cliente</span>
            </span>
          </button>
        ) : (
          <button className="aacp-login-btn aacp-google-login" onClick={vm.auth.openLogin} aria-label="Entrar">
            <LogIn size={15} />
            <span>Entrar</span>
          </button>
        )}

        <button
          className="aacp-cart-btn"
          onClick={() => vm.setCartOpen(true)}
          aria-expanded={vm.cartOpen}
          aria-controls="aacp-cart-panel"
          aria-label="Abrir resumo do pedido"
        >
          <ShoppingBag size={16} />
          {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}
        </button>
      </div>
    </header>
  );
}
