import {
  Headphones,
  LogIn,
  Moon,
  ShieldCheck,
  ShoppingBag,
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
            <IconFrame icon={ShieldCheck} status="online" />
          )}
        </div>

        <div className="aacp-header-copy">
          <div className="aacp-agent-name">
            {model.agent.name}
            <span className="aacp-agent-role">{model.agent.role}</span>
          </div>
          <div className="aacp-agent-sub">{model.agent.statusLabel}</div>
        </div>
      </div>

      <div className="aacp-header-security" aria-label={model.assurance.title}>
        <span className="aacp-header-security-icon" aria-hidden="true">
          <ShieldCheck size={15} />
        </span>
        <span>
          <strong>{model.assurance.title}</strong>
          <small>{model.assurance.description}</small>
        </span>
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
          <Headphones size={16} />
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
          <ShoppingBag size={16} />
          <span className="aacp-cart-btn-copy">
            <small>Total</small>
            <strong>{model.order.total}</strong>
          </span>
        </button>
      </div>
    </header>
  );
}
