import {
  Bot,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  Radio,
  ShoppingBag,
  Sun,
  Volume2,
} from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, quickReplyId } from "../../hooks/checkout-presentation.js";
import { useVoiceCheckoutExperience } from "../../hooks/use-voice-checkout-experience.js";
import { CheckoutPanels } from "../conversation/CheckoutPanels.js";
import { JourneyProtocol } from "../journey/JourneyProtocol.js";
import { CheckoutExperienceShell } from "../shell/CheckoutExperienceShell.js";
import { CheckoutExperienceOverlays } from "../shell/CheckoutExperienceOverlays.js";
import { OrderConfirmationView } from "../../components/checkout/ChatThread.js";
import { selectOrderConfirmationModel } from "../../presentation/selectors/order-confirmation.selector.js";
import { VoiceConfirmationPanel } from "./VoiceConfirmationPanel.js";
import "./voice-checkout-experience.css";

// Human-readable agent-state label for the live status pill. The pill is the
// "is the agent with me right now?" signal — it always names a single state.
const VOICE_STATE_LABEL: Record<string, string> = {
  speaking: "Falando",
  listening: "Ouvindo você",
  thinking: "Pensando",
  confirming: "Aguardando confirmação",
  idle: "Pronta",
};

/**
 * Voice checkout — chat layout, ambianced for voice (ADR §11.1).
 *
 * Voice ADDS, it does not replace: the experience reuses the chat spine
 * (status bar + journey stepper + the SAME `CheckoutPanels` action stack +
 * shared shell with the PIX waiting component), and layers the voice presence
 * (orb + state + captions + mic) on top. Frete, cupom, cross-sell and pagamento
 * are rendered by the same components as chat — one visual source of truth.
 *
 * Every e2e-contract selector is preserved: `data-channel="voice"`,
 * `data-stage`, `data-voice-state`, `.zyon-voice-shell`, `.zyon-voice-bar`,
 * `.zyon-voice-bar__state[data-state]`, `.zyon-voice-orb`, `.zyon-voice-caption`,
 * `.zyon-voice-caption__agent`, `.zyon-voice-mic` (aria-pressed),
 * `.zyon-voice-confirmation[data-risk]`, `.zyon-voice-chip(s)`, plus the shared
 * `.zyon-shipping-selector` / cross-sell / `.zyon-order-confirmation`.
 */
export function VoiceCheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  const { presentation, actions } = useVoiceCheckoutExperience(vm);
  const { header, voiceStage, orderStrip, panels } = presentation;

  const stateLabel = VOICE_STATE_LABEL[voiceStage.voiceState] ?? "Pronta";
  const showThinking = voiceStage.busy && !voiceStage.speaking;
  const isCompleted = presentation.checkoutStage === "completed";

  // ADR §9.2: while the PIX charge is awaiting the webhook, the voice presence
  // mirrors the waiting component — the orb reads as "thinking" and the caption
  // announces the active listening, unless the agent is mid speech/turn.
  const pixListening = vm.pixWaiting?.status === "listening";
  const ambientVoiceState =
    pixListening && voiceStage.voiceState === "idle" ? "thinking" : voiceStage.voiceState;
  const captionText =
    pixListening && !voiceStage.speaking
      ? "Aguardando confirmação do PIX…"
      : voiceStage.latestAgentText;

  return (
    <section
      className="checkout-experience zyon-page zyon-widget zyon-widget--voice"
      style={presentation.style}
      data-cart-open={presentation.cartOpen ? "true" : undefined}
      data-color-mode={presentation.colorMode}
      data-theme={presentation.colorMode}
      data-stage={presentation.checkoutStage}
      data-channel="voice"
      data-voice-state={ambientVoiceState}
    >
      <div className="zyon-voice-shell">
        {/* ---- Ambient status bar (shared spine, voice-dressed) ---------- */}
        <header className="zyon-voice-bar">
          <div className="zyon-voice-bar__brand">
            <span className="zyon-voice-bar__spark" aria-hidden="true" />
            <span className="zyon-voice-bar__brand-copy">
              <span className="zyon-voice-bar__merchant">{header.merchantName}</span>
              <span className="zyon-voice-header__mode">
                <Radio size={11} aria-hidden="true" />
                Checkout por voz
              </span>
            </span>
          </div>

          <p
            className="zyon-voice-bar__state"
            data-state={voiceStage.voiceState}
            aria-live="polite"
          >
            <span className="zyon-voice-bar__state-dot" aria-hidden="true" />
            <span className="zyon-voice-bar__state-label">{stateLabel}</span>
          </p>

          <div className="zyon-voice-bar__actions">
            <button
              type="button"
              className="zyon-voice-bar__order"
              onClick={header.onOpenCart}
              aria-expanded={header.cartOpen}
            >
              <ShoppingBag size={15} />
              <span>{header.orderTotalLabel}</span>
            </button>

            <button
              type="button"
              className="zyon-voice-bar__icon"
              onClick={header.onToggleColorMode}
              aria-label={header.colorMode === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {header.colorMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button
              type="button"
              className="zyon-voice-bar__switch"
              onClick={header.onSwitchToChat}
            >
              <MessageSquare size={14} />
              Chat
            </button>
          </div>
        </header>

        <main className="zyon-voice-main" aria-label="Sessão de compra por voz">
          {/* ---- Journey stepper (same component as chat) --------------- */}
          <div className="zyon-voice-journey">
            <JourneyProtocol model={presentation.journey} />
          </div>

          {/* ---- Voice presence layer: orb + live caption -------------- */}
          <div className="zyon-voice-stage">
            <div className="zyon-voice-presence">
              <div
                className={`zyon-voice-orb zyon-voice-orb--${ambientVoiceState}`}
                aria-hidden="true"
              >
                <span className="zyon-voice-orb__halo" />
                <span className="zyon-voice-orb__ring zyon-voice-orb__ring--outer" />
                <span className="zyon-voice-orb__ring zyon-voice-orb__ring--inner" />
                <span className="zyon-voice-orb__sheen" />
                <span className="zyon-voice-orb__core">
                  {voiceStage.agentAvatarUrl ? (
                    <img src={voiceStage.agentAvatarUrl} alt="" />
                  ) : (
                    <Bot size={36} strokeWidth={1.5} />
                  )}
                </span>
              </div>

              <div className="zyon-voice-presence__meta">
                <p className="zyon-voice-agent-name">{voiceStage.agentGiven}</p>
                <p
                  className={cn(
                    "zyon-voice-status",
                    showThinking ? "zyon-voice-status--busy" : "",
                  )}
                  aria-live="polite"
                >
                  {showThinking ? `${voiceStage.agentGiven} está pensando…` : voiceStage.hint}
                </p>
              </div>
            </div>

            <div className="zyon-voice-caption" aria-live="polite">
              <p className="zyon-voice-caption__agent">{captionText}</p>

              <div className="zyon-voice-caption__foot">
                {voiceStage.latestBuyerText ? (
                  <p className="zyon-voice-caption__buyer">
                    <span className="zyon-voice-caption__buyer-tag">Você</span>
                    <span className="zyon-voice-caption__buyer-text">
                      {voiceStage.latestBuyerText}
                    </span>
                  </p>
                ) : (
                  <span aria-hidden="true" />
                )}

                <button
                  type="button"
                  className="zyon-voice-caption__replay"
                  onClick={actions.replayAgentLine}
                  disabled={voiceStage.busy || voiceStage.speaking}
                >
                  <Volume2 size={13} />
                  Ouvir de novo
                </button>
              </div>
            </div>

            {voiceStage.pendingTurn ? (
              <VoiceConfirmationPanel
                pendingTurn={voiceStage.pendingTurn}
                busy={voiceStage.busy}
                onConfirm={() => void actions.confirmPendingTurn()}
                onRetry={actions.retryPendingTurn}
                onEditInChat={actions.editPendingTurnInChat}
              />
            ) : null}

            {/* ---- Mic dock ---------------------------------------------- */}
            <div className="zyon-voice-controls">
              {voiceStage.listening || voiceStage.speaking ? (
                <div
                  className={cn(
                    "zyon-voice-wave",
                    voiceStage.listening ? "is-listening" : "is-speaking",
                  )}
                  aria-hidden="true"
                >
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span
                      key={i}
                      className="zyon-voice-wave__bar"
                      style={{ ["--bar-index" as string]: i }}
                    />
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                className={cn(
                  "zyon-voice-mic",
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
                <span className="zyon-voice-mic__pulse" aria-hidden="true" />
                <span className="zyon-voice-mic__icon">
                  {voiceStage.speaking ? (
                    <Volume2 size={26} />
                  ) : voiceStage.listening ? (
                    <MicOff size={26} />
                  ) : (
                    <Mic size={26} />
                  )}
                </span>
              </button>
              <span className="zyon-voice-controls__label">
                {voiceStage.listening
                  ? "Toque para parar"
                  : voiceStage.speaking
                    ? `${voiceStage.agentGiven} está falando`
                    : "Toque e responda em voz alta"}
              </span>
            </div>

            {voiceStage.quickReplies ? (
              <div
                className="zyon-voice-chips"
                role="group"
                aria-label="Respostas sugeridas"
              >
                {voiceStage.quickReplies.items.map((reply) => (
                  <button
                    key={quickReplyId(reply)}
                    type="button"
                    className="zyon-voice-chip"
                    onClick={() => void voiceStage.quickReplies!.onTap(reply)}
                    disabled={voiceStage.quickReplies?.disabled}
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* ---- Shared action-panel stack (identical to chat) --------- */}
          <section className="zyon-voice-panels" aria-label="Ações do checkout">
            <CheckoutPanels model={panels} />

            {isCompleted ? (
              <OrderConfirmationView model={selectOrderConfirmationModel(vm)} />
            ) : null}
          </section>

          <button
            type="button"
            className="zyon-voice-order-strip"
            onClick={orderStrip.onOpenCart}
            aria-expanded={orderStrip.cartOpen}
          >
            <span className="zyon-voice-order-strip__label">Seu pedido</span>
            <span className="zyon-voice-order-strip__meta">
              {orderStrip.itemCountLabel} · {orderStrip.totalLabel}
            </span>
            <span className="zyon-voice-order-strip__action">Ver detalhes</span>
          </button>
        </main>

        <CheckoutExperienceShell vm={vm} />
      </div>

      <CheckoutExperienceOverlays vm={vm} />
    </section>
  );
}
