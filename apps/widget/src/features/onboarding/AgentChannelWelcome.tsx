import { Bot, MessageSquare, Mic } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { selectChannelWelcomeModel } from "../../presentation/selectors/channel-welcome.selector.js";
import type { ChannelWelcomeModel } from "../../presentation/models/channel-welcome.model.js";
import "./channel-welcome-modal.css";

export function AgentChannelWelcome({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectChannelWelcomeModel(vm);
  if (!model.visible) return null;
  return <AgentChannelWelcomeView model={model} />;
}

export function AgentChannelWelcomeView({ model }: { model: ChannelWelcomeModel }) {
  return (
    <div className="zyon-channel-gate" data-theme={model.colorMode} role="presentation">
      <div className="zyon-channel-gate__backdrop" aria-hidden="true" />

      <section
        className="zyon-channel-gate__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zyon-channel-welcome-title"
      >
        <div className="zyon-channel-gate__scan" aria-hidden="true" />

        <header className="zyon-channel-gate__head">
          <div className="zyon-channel-gate__agent" aria-hidden="true">
            {model.agentAvatarUrl ? (
              <img src={model.agentAvatarUrl} alt="" />
            ) : (
              <Bot size={30} strokeWidth={1.6} />
            )}
            <span className="zyon-channel-gate__agent-pulse" />
          </div>

          <div className="zyon-channel-gate__meta">
            <span className="zyon-channel-gate__merchant">{model.merchantName}</span>
            <span className="zyon-channel-gate__status">Online agora</span>
          </div>
        </header>

        <h2 id="zyon-channel-welcome-title" className="zyon-channel-gate__title">
          Sou <em>{model.agentName}</em>
        </h2>

        <p className="zyon-channel-gate__lead">
          Vou conduzir sua compra na {model.merchantName}. Escolha como prefere seguir: fale comigo por
          voz ou converse por chat. Seu pedido fica visível o tempo todo.
        </p>

        {model.networkError ? (
          <div className="zyon-channel-gate__alert" role="alert">
            <p>{model.networkError}</p>
            <button type="button" className="zyon-channel-gate__retry" onClick={model.onRetry}>
              Tentar conectar de novo
            </button>
          </div>
        ) : !model.channelReady ? (
          <p className="zyon-channel-gate__loading" aria-live="polite">
            <span className="zyon-channel-gate__loading-dot" aria-hidden="true" />
            Sincronizando sessão com a loja…
          </p>
        ) : null}

        <div className="zyon-channel-gate__channels" role="group" aria-label="Escolha como comprar">
          <button
            type="button"
            className="zyon-channel-gate__channel zyon-channel-gate__channel--voice is-featured"
            onClick={model.onSelectVoice}
            disabled={model.busy || !model.channelReady}
          >
            <span className="zyon-channel-gate__channel-icon" aria-hidden="true">
              <Mic size={20} strokeWidth={1.75} />
            </span>
            <span className="zyon-channel-gate__channel-copy">
              <strong>Comprar por voz</strong>
              <small>Responda falando. Eu guio cada etapa até o pagamento.</small>
            </span>
            <span className="zyon-channel-gate__channel-tag">Recomendado</span>
          </button>

          <button
            type="button"
            className="zyon-channel-gate__channel zyon-channel-gate__channel--chat"
            onClick={model.onSelectChat}
            disabled={model.busy || !model.channelReady}
          >
            <span className="zyon-channel-gate__channel-icon" aria-hidden="true">
              <MessageSquare size={20} strokeWidth={1.75} />
            </span>
            <span className="zyon-channel-gate__channel-copy">
              <strong>Comprar por chat</strong>
              <small>Digite no seu ritmo, com as mesmas respostas e sugestões.</small>
            </span>
            <span className="zyon-channel-gate__channel-tag">Texto</span>
          </button>
        </div>
      </section>
    </div>
  );
}
