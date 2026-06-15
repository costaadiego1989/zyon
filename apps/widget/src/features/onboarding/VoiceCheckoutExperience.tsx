import { useMemo } from "react";
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
import {
  agentGivenAndRest,
  cn,
  formatCurrency,
  quickReplyId,
  stripAgentMessagePrefix,
  STAGE_FLOW,
} from "../../hooks/checkout-view-model.js";
import { useVoiceCheckout } from "../../hooks/use-voice-checkout.js";
import { selectCheckoutExperiencePresentation } from "../../presentation/checkout-experience-model.js";
import { CreditCardForm } from "../../components/checkout/CreditCardForm.js";
import { CryptoPaymentPanel } from "../../components/checkout/CryptoPaymentPanel.js";
import { ShippingSelector } from "../../components/checkout/ShippingSelector.js";
import {
  CouponBox,
  NetworkError,
  OfferBanner,
  PendingOfferBanner,
} from "../../components/checkout/ChatThread.js";
import { BuyerGuestModal } from "../../components/checkout/BuyerGuestModal.js";
import { CartFAB } from "../../components/checkout/CartFAB.js";
import { CartPanel } from "../../components/checkout/CartPanel.js";
import { GlobalAuthModal } from "../../components/checkout/GlobalAuthModal.js";
import { SupportPanel } from "../../components/checkout/SupportPanel.js";
import { ThemeStudio } from "../../components/checkout/ThemeStudio.js";
import { UserPanel } from "../../components/checkout/UserPanel.js";
import { AgentChannelWelcome } from "./AgentChannelWelcome.js";
import "./voice-checkout-experience.css";

function latestTurnText(
  turns: CheckoutAgentViewModel["turns"],
  role: "agent" | "buyer",
): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === role && turn.text.trim()) {
      return turn.text.trim();
    }
  }
  return null;
}

function voiceStageIndex(stage: string): number {
  const index = STAGE_FLOW.findIndex((step) => step.key === stage);
  return index >= 0 ? index : 0;
}

export function VoiceCheckoutExperience({ vm }: { vm: CheckoutAgentViewModel }) {
  const presentation = selectCheckoutExperiencePresentation(vm);
  const agentName = vm.theme.agentName || vm.activeExperience.agent.name;
  const agentGiven = agentGivenAndRest(agentName).given || agentName;
  const latestAgentRaw = useMemo(() => latestTurnText(vm.turns, "agent"), [vm.turns]);
  const latestAgentText = latestAgentRaw
    ? stripAgentMessagePrefix(latestAgentRaw, agentName)
    : vm.activeExperience.agent.greeting || "Vou conduzir sua compra por voz. Pode falar comigo.";
  const latestBuyerText = useMemo(() => latestTurnText(vm.turns, "buyer"), [vm.turns]);
  const stageIndex = voiceStageIndex(vm.checkoutStage);
  const itemCountLabel =
    vm.cartItemCount === 1 ? "1 item" : `${vm.cartItemCount} itens`;

  const voice = useVoiceCheckout({
    enabled: !vm.showChannelWelcome,
    busy: vm.busy,
    composerLocked: vm.composerLocked,
    awaitingAgentPlayback: vm.awaitingAgentPlayback,
    latestAgentText: latestAgentRaw,
    onTranscript: (text) => vm.sendMessageWithOverride(text),
  });

  function switchToChat(): void {
    voice.stopAll();
    vm.selectPurchaseChannel("chat");
  }

  const micDisabled = vm.busy || vm.composerLocked || voice.speaking;
  const voiceState = voice.speaking
    ? "speaking"
    : voice.listening
      ? "listening"
      : vm.busy
        ? "thinking"
        : "idle";

  return (
    <section
      className="checkout-experience aacp-page aacp-widget aacp-widget--voice"
      style={presentation.style}
      data-cart-open={vm.cartOpen ? "true" : undefined}
      data-color-mode={presentation.colorMode}
      data-theme={presentation.colorMode}
      data-stage={presentation.stage}
      data-channel="voice"
      data-voice-state={voiceState}
    >
      <div className="aacp-voice-shell">
        <header className="aacp-voice-header">
          <div className="aacp-voice-header__brand">
            <span className="aacp-voice-header__merchant">{vm.activeExperience.brand.name}</span>
            <span className="aacp-voice-header__mode">Compra por voz</span>
          </div>

          <div className="aacp-voice-header__actions">
            <button
              type="button"
              className="aacp-voice-header__order"
              onClick={() => vm.setCartOpen(true)}
              aria-expanded={vm.cartOpen}
            >
              <ShoppingBag size={16} />
              <span>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</span>
              <small>{itemCountLabel}</small>
            </button>

            <button
              type="button"
              className="aacp-voice-header__icon"
              onClick={vm.toggleColorMode}
              aria-label={vm.colorMode === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {vm.colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button type="button" className="aacp-voice-header__switch" onClick={switchToChat}>
              <MessageSquare size={15} />
              Chat
            </button>
          </div>
        </header>

        <main className="aacp-voice-main" aria-label="Sessão de compra por voz">
          <ol className="aacp-voice-progress" aria-label="Etapas da compra">
            {STAGE_FLOW.map((step, index) => (
              <li
                key={step.key}
                className={cn(
                  "aacp-voice-progress__step",
                  index < stageIndex ? "is-done" : "",
                  index === stageIndex ? "is-active" : "",
                )}
                aria-current={index === stageIndex ? "step" : undefined}
              >
                <span className="aacp-voice-progress__dot" aria-hidden="true" />
                <span className="aacp-voice-progress__label">{step.shortLabel}</span>
              </li>
            ))}
          </ol>

          <div className="aacp-voice-stage">
            <div className={`aacp-voice-orb aacp-voice-orb--${voiceState}`} aria-hidden="true">
              <span className="aacp-voice-orb__ring aacp-voice-orb__ring--outer" />
              <span className="aacp-voice-orb__ring aacp-voice-orb__ring--inner" />
              <span className="aacp-voice-orb__core">
                {vm.theme.agentAvatarUrl ? (
                  <img src={vm.theme.agentAvatarUrl} alt="" />
                ) : (
                  <Bot size={42} strokeWidth={1.5} />
                )}
              </span>
            </div>

            <p className="aacp-voice-agent-name">{agentGiven}</p>

            <div className="aacp-voice-caption" aria-live="polite">
              <p className="aacp-voice-caption__agent">{latestAgentText}</p>
              {latestBuyerText ? (
                <p className="aacp-voice-caption__buyer">Você: {latestBuyerText}</p>
              ) : null}
            </div>

            {vm.networkError ? <NetworkError vm={vm} /> : null}

            {vm.busy && !voice.speaking ? (
              <p className="aacp-voice-status aacp-voice-status--busy" aria-live="polite">
                {agentGiven} está pensando…
              </p>
            ) : (
              <p className="aacp-voice-status">{voice.hint}</p>
            )}

            <div className="aacp-voice-controls">
              <button
                type="button"
                className={cn(
                  "aacp-voice-mic",
                  voice.listening ? "is-listening" : "",
                  voice.speaking ? "is-speaking" : "",
                )}
                onClick={() => {
                  if (voice.unsupported) {
                    switchToChat();
                    return;
                  }
                  voice.handleMicPress();
                }}
                disabled={micDisabled && !voice.listening}
                aria-pressed={voice.listening}
                aria-label={
                  voice.listening
                    ? "Parar de ouvir"
                    : voice.speaking
                      ? "Agente falando"
                      : "Falar resposta"
                }
              >
                {voice.speaking ? (
                  <Volume2 size={30} />
                ) : voice.listening ? (
                  <MicOff size={30} />
                ) : (
                  <Mic size={30} />
                )}
              </button>
              <span className="aacp-voice-controls__label">
                {voice.listening ? "Ouvindo você" : voice.speaking ? "Falando" : "Toque para responder"}
              </span>
            </div>

            {!vm.composerLocked && vm.quickReplies.length > 0 ? (
              <div className="aacp-voice-chips" role="group" aria-label="Respostas sugeridas">
                {vm.quickReplies.map((reply) => (
                  <button
                    key={quickReplyId(reply)}
                    type="button"
                    className="aacp-voice-chip"
                    onClick={() => void vm.tapQuick(reply)}
                    disabled={vm.busy}
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <section className="aacp-voice-panels" aria-label="Ações do checkout">
            {vm.showOfferBanner ? <OfferBanner vm={vm} /> : null}
            {vm.showPendingOffer ? <PendingOfferBanner vm={vm} /> : null}
            {vm.showCouponBox ? <CouponBox vm={vm} /> : null}

            {!vm.selectedShippingMethod &&
            !vm.activeExperience.shipping &&
            vm.shippingOptions.length > 0 &&
            vm.checkoutStage === "shipping" &&
            vm.lastChat?.missing_fields?.[0] === "frete" ? (
              <ShippingSelector
                options={vm.shippingOptions}
                selectedMethod={vm.selectedShippingMethod}
                onSelect={(opt) => void vm.tapShippingOption(opt)}
                busy={vm.busy}
              />
            ) : null}

            {vm.showCardForm && vm.checkoutStage !== "completed" ? <CreditCardForm vm={vm} /> : null}

            {vm.showCryptoPanel && vm.cryptoPayment && vm.checkoutStage !== "completed" ? (
              <CryptoPaymentPanel vm={vm} />
            ) : null}
          </section>

          <button
            type="button"
            className="aacp-voice-order-strip"
            onClick={() => vm.setCartOpen(true)}
            aria-expanded={vm.cartOpen}
          >
            <span className="aacp-voice-order-strip__label">Seu pedido</span>
            <span className="aacp-voice-order-strip__meta">
              {itemCountLabel} · {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}
            </span>
            <span className="aacp-voice-order-strip__action">Ver detalhes</span>
          </button>
        </main>

        <CartPanel vm={vm} />
        <UserPanel vm={vm} />

        <div
          className={cn("aacp-cart-overlay", vm.cartOpen ? "open" : "")}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo do pedido"
        />
      </div>

      <SupportPanel vm={vm} />
      <CartFAB vm={vm} />
      <ThemeStudio studio={vm.themeStudio} theme={vm.theme} />
      <BuyerGuestModal vm={vm} />
      <GlobalAuthModal auth={vm.auth} hub={vm.hub} />
      <AgentChannelWelcome vm={vm} />
    </section>
  );
}
