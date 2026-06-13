import { ArrowLeft, Bot, LogIn, ShoppingBag } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, formatCurrency, resolveStoreReturnUrl } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.theme.agentName || vm.activeExperience.agent.name);
  const headerTitle = vm.theme.headerTitle?.trim() || agentName.given;
  const headerSubtitle =
    vm.theme.headerSubtitle?.trim() ||
    `${vm.activeExperience.brand.name} · online · responde em segundos`;
  const storeUrl = resolveStoreReturnUrl(vm.config);
  const openAccount = () => {
    if (vm.auth.session?.global_user_id) {
      vm.setUserPanelOpen(true);
      return;
    }
    vm.auth.openHub();
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
          <div className="aacp-agent-sub">
            <span className="live-dot" />
            {headerSubtitle}
          </div>
        </div>
      </div>

      <div className="aacp-header-actions">
        {storeUrl ? (
          <a className="aacp-back-to-store" href={storeUrl} aria-label="Voltar ao site">
            <ArrowLeft size={15} aria-hidden />
            <span>Voltar ao site</span>
          </a>
        ) : null}

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
