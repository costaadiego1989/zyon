import { Bot, MessageSquare, Mic } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import "./channel-welcome-modal.css";

export function AgentChannelWelcome({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showChannelWelcome) return null;

  const configuredAgentName = vm.theme.agentName || vm.activeExperience.agent.name;
  const displayName = configuredAgentName.trim() || "seu assistente";
  const merchantName = vm.activeExperience.brand.name;
  const channelReady = Boolean(vm.session) && !vm.networkError;

  return (
    <div className="aacp-channel-gate" data-theme={vm.colorMode} role="presentation">
      <div className="aacp-channel-gate__backdrop" aria-hidden="true" />

      <section
        className="aacp-channel-gate__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aacp-channel-welcome-title"
      >
        <div className="aacp-channel-gate__scan" aria-hidden="true" />

        <header className="aacp-channel-gate__head">
          <div className="aacp-channel-gate__agent" aria-hidden="true">
            {vm.theme.agentAvatarUrl ? (
              <img src={vm.theme.agentAvatarUrl} alt="" />
            ) : (
              <Bot size={30} strokeWidth={1.6} />
            )}
            <span className="aacp-channel-gate__agent-pulse" />
          </div>

          <div className="aacp-channel-gate__meta">
            <span className="aacp-channel-gate__merchant">{merchantName}</span>
            <span className="aacp-channel-gate__status">Online agora</span>
          </div>
        </header>

        <h2 id="aacp-channel-welcome-title" className="aacp-channel-gate__title">
          Sou <em>{displayName}</em>
        </h2>

        <p className="aacp-channel-gate__lead">
          Vou conduzir sua compra na {merchantName}. Escolha como prefere seguir: fale comigo por
          voz ou converse por chat. Seu pedido fica visível o tempo todo.
        </p>

        {vm.networkError ? (
          <div className="aacp-channel-gate__alert" role="alert">
            <p>{vm.networkError}</p>
            <button type="button" className="aacp-channel-gate__retry" onClick={() => vm.retryStartCheckout()}>
              Tentar conectar de novo
            </button>
          </div>
        ) : !channelReady ? (
          <p className="aacp-channel-gate__loading" aria-live="polite">
            <span className="aacp-channel-gate__loading-dot" aria-hidden="true" />
            Sincronizando sessão com a loja…
          </p>
        ) : null}

        <div className="aacp-channel-gate__channels" role="group" aria-label="Escolha como comprar">
          <button
            type="button"
            className="aacp-channel-gate__channel aacp-channel-gate__channel--voice is-featured"
            onClick={() => vm.selectPurchaseChannel("voice")}
            disabled={vm.busy || !channelReady}
          >
            <span className="aacp-channel-gate__channel-icon" aria-hidden="true">
              <Mic size={20} strokeWidth={1.75} />
            </span>
            <span className="aacp-channel-gate__channel-copy">
              <strong>Comprar por voz</strong>
              <small>Responda falando. Eu guio cada etapa até o pagamento.</small>
            </span>
            <span className="aacp-channel-gate__channel-tag">Recomendado</span>
          </button>

          <button
            type="button"
            className="aacp-channel-gate__channel aacp-channel-gate__channel--chat"
            onClick={() => vm.selectPurchaseChannel("chat")}
            disabled={vm.busy || !channelReady}
          >
            <span className="aacp-channel-gate__channel-icon" aria-hidden="true">
              <MessageSquare size={20} strokeWidth={1.75} />
            </span>
            <span className="aacp-channel-gate__channel-copy">
              <strong>Comprar por chat</strong>
              <small>Digite no seu ritmo, com as mesmas respostas e sugestões.</small>
            </span>
            <span className="aacp-channel-gate__channel-tag">Texto</span>
          </button>
        </div>
      </section>
    </div>
  );
}
