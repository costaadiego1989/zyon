import { LogIn, Moon, ShoppingBag, Sparkles, Sun } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, formatCurrency } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const isDark = vm.colorMode === "dark";

  return (
    <header className="aacp-header">
      <div className="aacp-header-left">
        <div className="aacp-avatar" aria-hidden="true">
          {vm.theme.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
          ) : (
            <Sparkles size={20} />
          )}
          <span className="aacp-status-dot" />
        </div>
        <div>
          <div className="aacp-agent-name">
            {agentName.given} <span className="sep">·</span>{" "}
            <span className="role">{agentName.rest || "Assistente de Vendas"}</span>
          </div>
          <div className="aacp-agent-sub">
            <span className="live-dot" />
            {vm.activeExperience.brand.name} · online · responde em segundos
          </div>
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

        {vm.auth.session || vm.activeExperience?.customer?.email_verified ? (
          <button className="aacp-user-chip" onClick={() => vm.setUserPanelOpen(true)} aria-label="Abrir conta">
            <span className="aacp-user-avatar">
              {(vm.activeExperience?.customer?.fullName || "C")[0]}
            </span>
            <span className="aacp-user-chip-name">
              {vm.activeExperience?.customer?.fullName?.split(" ")[0] || "Cliente"}
            </span>
          </button>
        ) : (
          <button className="aacp-login-btn" onClick={vm.auth.openLogin} aria-label="Entrar">
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
