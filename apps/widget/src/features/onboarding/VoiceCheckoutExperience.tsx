import {
  Bot,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  ShoppingBag,
  Sun,
  Volume2,
} from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, quickReplyId } from "../../hooks/checkout-view-model.js";
import { useVoiceCheckoutExperience } from "../../hooks/use-voice-checkout-experience.js";
import { CheckoutPanels } from "../conversation/CheckoutPanels.js";
import { NetworkErrorView } from "../conversation/CheckoutActionPanels.js";
import { JourneyProtocol } from "../journey/JourneyProtocol.js";
import { CheckoutExperienceShell } from "../shell/CheckoutExperienceShell.js";
import { CheckoutExperienceOverlays } from "../shell/CheckoutExperienceOverlays.js";
import { VoiceConfirmationPanel } from "./VoiceConfirmationPanel.js";
import "./voice-checkout-experience.css";

export function VoiceCheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  const { presentation, actions } = useVoiceCheckoutExperience(vm);
  const { header, voiceStage, orderStrip, panels } = presentation;

  return (
    <section
      className="checkout-experience aacp-page aacp-widget aacp-widget--voice"
      style={presentation.style}
      data-cart-open={presentation.cartOpen ? "true" : undefined}
      data-color-mode={presentation.colorMode}
      data-theme={presentation.colorMode}
      data-stage={presentation.checkoutStage}
      data-channel="voice"
      data-voice-state={voiceStage.voiceState}
    >
      <div className="aacp-voice-shell">
        <header className="aacp-voice-header">
          <div className="aacp-voice-header__brand">
            <span className="aacp-voice-header__merchant">{header.merchantName}</span>
            <span className="aacp-voice-header__mode">Compra por voz</span>
          </div>

          <div className="aacp-voice-header__actions">
            <button
              type="button"
              className="aacp-voice-header__order"
              onClick={header.onOpenCart}
              aria-expanded={header.cartOpen}
            >
              <ShoppingBag size={16} />
              <span>{header.orderTotalLabel}</span>
              <small>{header.itemCountLabel}</small>
            </button>

            <button
              type="button"
              className="aacp-voice-header__icon"
              onClick={header.onToggleColorMode}
              aria-label={header.colorMode === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {header.colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button
              type="button"
              className="aacp-voice-header__switch"
              onClick={header.onSwitchToChat}
            >
              <MessageSquare size={15} />
              Chat
            </button>
          </div>
        </header>

        <main className="aacp-voice-main" aria-label="Sessão de compra por voz">
          <div className="aacp-voice-journey">
            <JourneyProtocol model={presentation.journey} />
          </div>

          <div className="aacp-voice-stage">
            <div
              className={`aacp-voice-orb aacp-voice-orb--${voiceStage.voiceState}`}
              aria-hidden="true"
            >
              <span className="aacp-voice-orb__ring aacp-voice-orb__ring--outer" />
              <span className="aacp-voice-orb__ring aacp-voice-orb__ring--inner" />
              <span className="aacp-voice-orb__core">
                {voiceStage.agentAvatarUrl ? (
                  <img src={voiceStage.agentAvatarUrl} alt="" />
                ) : (
                  <Bot size={42} strokeWidth={1.5} />
                )}
              </span>
            </div>

            <p className="aacp-voice-agent-name">{voiceStage.agentGiven}</p>

            <div className="aacp-voice-caption" aria-live="polite">
              <p className="aacp-voice-caption__agent">{voiceStage.latestAgentText}</p>
              <button
                type="button"
                className="aacp-voice-caption__replay"
                onClick={actions.replayAgentLine}
                disabled={voiceStage.busy || voiceStage.speaking}
              >
                <Volume2 size={14} />
                Ouvir pergunta
              </button>
              {voiceStage.latestBuyerText ? (
                <p className="aacp-voice-caption__buyer">
                  Você: {voiceStage.latestBuyerText}
                </p>
              ) : null}
            </div>

            {panels.networkError ? (
              <NetworkErrorView model={panels.networkError} />
            ) : null}

            {voiceStage.busy && !voiceStage.speaking ? (
              <p className="aacp-voice-status aacp-voice-status--busy" aria-live="polite">
                {voiceStage.agentGiven} está pensando…
              </p>
            ) : (
              <p className="aacp-voice-status">{voiceStage.hint}</p>
            )}

            {voiceStage.pendingTurn ? (
              <VoiceConfirmationPanel
                pendingTurn={voiceStage.pendingTurn}
                busy={voiceStage.busy}
                onConfirm={() => void actions.confirmPendingTurn()}
                onRetry={actions.retryPendingTurn}
                onEditInChat={actions.editPendingTurnInChat}
              />
            ) : null}

            <div className="aacp-voice-controls">
              <button
                type="button"
                className={cn(
                  "aacp-voice-mic",
                  voiceStage.listening ? "is-listening" : "",
                  voiceStage.speaking ? "is-speaking" : "",
                )}
                onClick={actions.handleMicPress}
                disabled={voiceStage.micDisabled && !voiceStage.listening}
                aria-pressed={voiceStage.listening}
                aria-label={
                  voiceStage.pendingTurn
                    ? "Confirmação de voz pendente"
                    : voiceStage.listening
                      ? "Parar de ouvir"
                      : voiceStage.speaking
                        ? "Agente falando"
                        : "Falar resposta"
                }
              >
                {voiceStage.speaking ? (
                  <Volume2 size={30} />
                ) : voiceStage.listening ? (
                  <MicOff size={30} />
                ) : (
                  <Mic size={30} />
                )}
              </button>
              <span className="aacp-voice-controls__label">
                {voiceStage.listening
                  ? "Ouvindo você"
                  : voiceStage.speaking
                    ? "Falando"
                    : "Toque para responder"}
              </span>
            </div>

            {voiceStage.quickReplies ? (
              <div className="aacp-voice-chips" role="group" aria-label="Respostas sugeridas">
                {voiceStage.quickReplies.items.map((reply) => (
                  <button
                    key={quickReplyId(reply)}
                    type="button"
                    className="aacp-voice-chip"
                    onClick={() => void voiceStage.quickReplies!.onTap(reply)}
                    disabled={voiceStage.quickReplies?.disabled}
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <section className="aacp-voice-panels" aria-label="Ações do checkout">
            <CheckoutPanels model={panels} vm={vm} />
          </section>

          <button
            type="button"
            className="aacp-voice-order-strip"
            onClick={orderStrip.onOpenCart}
            aria-expanded={orderStrip.cartOpen}
          >
            <span className="aacp-voice-order-strip__label">Seu pedido</span>
            <span className="aacp-voice-order-strip__meta">
              {orderStrip.itemCountLabel} · {orderStrip.totalLabel}
            </span>
            <span className="aacp-voice-order-strip__action">Ver detalhes</span>
          </button>
        </main>

        <CheckoutExperienceShell vm={vm} />
      </div>

      <CheckoutExperienceOverlays vm={vm} />
    </section>
  );
}
