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
    <header className="zyon-header zyon-shell-header zyon-chat-header">
      <div className="zyon-header-left">
        <div className="zyon-header-agent-avatar" aria-label="Agente de compras">
          {model.agent.avatarUrl ? (
            <img src={model.agent.avatarUrl} alt="" className="zyon-header-agent-img" />
          ) : (
            <IconFrame icon={Bot} status="none" label="Agente de compras" />
          )}
        </div>

        <div className="zyon-header-copy">
          <span className="zyon-agent-context">Checkout assistido</span>
          <div className="zyon-agent-name">{model.agent.name}</div>
          <div className="zyon-agent-sub">{model.agent.role}</div>
        </div>
      </div>

      <div className="zyon-header-presence" aria-label={model.agent.statusLabel}>
        <span>{model.agent.statusLabel}</span>
      </div>

      <div className="zyon-header-actions">
        <button
          className="zyon-icon-btn zyon-header-help"
          onClick={model.support.onToggle}
          aria-label={model.support.isOpen ? "Fechar ajuda" : "Abrir ajuda"}
          aria-expanded={model.support.isOpen}
          aria-controls="zyon-support-panel"
          type="button"
        >
          <CircleHelp size={17} />
          <span className="zyon-header-action-label">Ajuda</span>
        </button>

        <button
          className="zyon-icon-btn"
          onClick={model.onToggleColorMode}
          aria-label={isDark ? "Modo claro" : "Modo escuro"}
          title={isDark ? "Modo claro" : "Modo escuro"}
          type="button"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {model.account.kind === "anonymous" ? (
          <button
            className="zyon-login-btn zyon-google-login"
            onClick={model.account.onOpen}
            aria-label="Entrar"
            type="button"
          >
            <LogIn size={15} />
            <span>Entrar</span>
          </button>
        ) : (
          <button
            id={model.account.kind === "recognized" ? "zyon-login-btn" : undefined}
            className="zyon-user-chip"
            onClick={model.account.onOpen}
            aria-label={model.account.kind === "recognized" ? "Abrir conta" : "Minha conta"}
            type="button"
          >
            <span className="zyon-user-avatar">{model.account.initial}</span>
            <span className="zyon-user-chip-name">
              {model.account.label}
              {model.account.kind === "recognized" ? (
                <span className="zyon-user-chip-sub"> | Cliente</span>
              ) : null}
            </span>
          </button>
        )}

        <button
          className="zyon-cart-btn"
          onClick={model.order.onOpen}
          aria-expanded={model.order.isOpen}
          aria-controls="zyon-cart-panel"
          aria-label="Abrir resumo do pedido"
          type="button"
        >
          <ShoppingCart size={16} className="zyon-cart-btn-icon" aria-hidden="true" />
          <span className="zyon-cart-btn-copy">
            <small>Pedido</small>
            <strong>{model.order.total}</strong>
          </span>
        </button>
      </div>
    </header>
  );
}
