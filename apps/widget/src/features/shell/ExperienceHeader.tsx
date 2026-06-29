import {
  Bot,
  CircleHelp,
  LogIn,
  Moon,
  ShoppingCart,
  Sun,
} from "lucide-react";
import type { ExperienceHeaderModel } from "../../presentation/checkout-experience-model.js";
import { IconFrame } from "../../design-system/primitives/IconFrame.js";

export function ExperienceHeader({ model }: { model: ExperienceHeaderModel }) {
  const isDark = model.colorMode === "dark";

  return (
    <header className="aacp-header aacp-shell-header aacp-chat-header">
      <div className="aacp-header-left">
        <div className="aacp-header-agent-avatar" aria-label="Agente de compras">
          {model.agent.avatarUrl ? (
            <img src={model.agent.avatarUrl} alt="" className="aacp-header-agent-img" />
          ) : (
            <IconFrame icon={Bot} status="none" label="Agente de compras" />
          )}
        </div>

        <div className="aacp-header-copy">
          <span className="aacp-agent-context">Checkout assistido</span>
          <div className="aacp-agent-name">{model.agent.name}</div>
          <div className="aacp-agent-sub">{model.agent.role}</div>
        </div>
      </div>

      <div className="aacp-header-presence" aria-label={model.agent.statusLabel}>
        <span>{model.agent.statusLabel}</span>
      </div>

      <div className="aacp-header-actions">
        <button
          className="aacp-icon-btn aacp-header-help"
          onClick={model.support.onToggle}
          aria-label={model.support.isOpen ? "Fechar ajuda" : "Abrir ajuda"}
          aria-expanded={model.support.isOpen}
          aria-controls="aacp-support-panel"
          type="button"
        >
          <CircleHelp size={17} />
          <span className="aacp-header-action-label">Ajuda</span>
        </button>

        <button
          className="aacp-icon-btn"
          onClick={model.onToggleColorMode}
          aria-label={isDark ? "Modo claro" : "Modo escuro"}
          title={isDark ? "Modo claro" : "Modo escuro"}
          type="button"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {model.account.kind === "anonymous" ? (
          <button
            className="aacp-login-btn aacp-google-login"
            onClick={model.account.onOpen}
            aria-label="Entrar"
            type="button"
          >
            <LogIn size={15} />
            <span>Entrar</span>
          </button>
        ) : (
          <button
            id={model.account.kind === "recognized" ? "aacp-login-btn" : undefined}
            className="aacp-user-chip"
            onClick={model.account.onOpen}
            aria-label={model.account.kind === "recognized" ? "Abrir conta" : "Minha conta"}
            type="button"
          >
            <span className="aacp-user-avatar">{model.account.initial}</span>
            <span className="aacp-user-chip-name">
              {model.account.label}
              {model.account.kind === "recognized" ? (
                <span className="aacp-user-chip-sub"> | Cliente</span>
              ) : null}
            </span>
          </button>
        )}

        <button
          className="aacp-cart-btn"
          onClick={model.order.onOpen}
          aria-expanded={model.order.isOpen}
          aria-controls="aacp-cart-panel"
          aria-label="Abrir resumo do pedido"
          type="button"
        >
          <ShoppingCart size={16} className="aacp-cart-btn-icon" aria-hidden="true" />
          <span className="aacp-cart-btn-copy">
            <small>Pedido</small>
            <strong>{model.order.total}</strong>
          </span>
        </button>
      </div>
    </header>
  );
}
