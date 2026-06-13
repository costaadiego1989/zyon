import { Bot, LogIn, Moon, ShieldCheck, ShoppingBag, Sun } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, formatCurrency } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.theme.agentName || vm.activeExperience.agent.name);
  const headerTitle = vm.theme.headerTitle?.trim() || agentName.given;
  const headerSubtitle =
    vm.theme.headerSubtitle?.trim() ||
    `${vm.activeExperience.brand.name} · online · responde em segundos`;
  const isDark = vm.colorMode === "dark";
  const openAccount = () => {
    void vm.openBuyerPanel();
  };

  return (
    <header className="aacp-header aacp-shell-header aacp-chat-header">
      <div className="aacp-header-left">
        <div className="aacp-header-agent-avatar" aria-label="Assistente virtual">
          {vm.theme.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" className="aacp-header-agent-img" />
          ) : (
            <Bot size={22} strokeWidth={2} />
          )}
          <span className="aacp-status-dot" />
        </div>

        <div className="aacp-header-copy">
          <div className="aacp-agent-name">
            {headerTitle}
            <span className="aacp-agent-role">
              {agentName.rest || "Assistente de Vendas"}
            </span>
          </div>
          <div className="aacp-agent-sub">{headerSubtitle}</div>
        </div>
      </div>

      <div className="aacp-header-security" aria-label="Checkout seguro">
        <span className="aacp-header-security-icon" aria-hidden="true">
          <ShieldCheck size={15} />
        </span>
        <span>
          <strong>Checkout seguro</strong>
          <small>Dados protegidos</small>
        </span>
      </div>

      <div className="aacp-header-actions">
        <button
          className="aacp-icon-btn"
          onClick={vm.toggleColorMode}
          aria-label={isDark ? "Modo claro" : "Modo escuro"}
          title={isDark ? "Modo claro" : "Modo escuro"}
          type="button"
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
          <button id="aacp-login-btn" className="aacp-user-chip" onClick={() => void vm.openBuyerPanel()} aria-label="Abrir conta">
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
          type="button"
        >
          <ShoppingBag size={16} />
          <span className="aacp-cart-btn-copy">
            <small>Total</small>
            <strong>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</strong>
          </span>
        </button>
      </div>
    </header>
  );
}
