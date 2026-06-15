import { useMemo } from "react";
import {
  Bot,
  Check,
  Edit3,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  RotateCcw,
  ShieldCheck,
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
import {
  useVoiceCheckout,
  type PendingVoiceTurn,
  type PendingVoiceTurnDraft,
} from "../../hooks/use-voice-checkout.js";
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

function normalizeVoiceText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function describePendingVoiceTurn(
  vm: CheckoutAgentViewModel,
  transcript: string,
): PendingVoiceTurnDraft {
  const normalized = normalizeVoiceText(transcript);
  const missingField = normalizeVoiceText(vm.lastChat?.missing_fields?.[0] ?? "");

  if (vm.checkoutStage === "data_collection") {
    if (missingField.includes("cpf") || /\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}\b/.test(transcript)) {
      return {
        interpretedAction: "Enviar este CPF para emissão fiscal. Você revisa o pedido antes de pagar.",
        riskLevel: "high",
        field: "cpf",
      };
    }

    if (missingField.includes("email") || /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(transcript)) {
      return {
        interpretedAction: "Usar este e-mail para recibo, acesso ao pedido e acompanhamento.",
        riskLevel: "medium",
        field: "email",
      };
    }

    return {
      interpretedAction: "Enviar esta informação de cadastro para continuar a compra.",
      riskLevel: "medium",
      field: "generic",
    };
  }

  if (vm.checkoutStage === "shipping") {
    return {
      interpretedAction: "Enviar sua escolha ou dúvida de entrega. Frete e prazo continuam visíveis antes do pagamento.",
      riskLevel: "medium",
      field: "shipping",
    };
  }

  if (vm.checkoutStage === "payment") {
    if (normalized.includes("pix")) {
      return {
        interpretedAction: `Solicitar pagamento via PIX para ${formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}.`,
        riskLevel: "high",
        field: "payment",
      };
    }

    if (normalized.includes("cartao") || normalized.includes("credito") || normalized.includes("debito")) {
      return {
        interpretedAction: `Abrir pagamento por cartão para ${formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}.`,
        riskLevel: "high",
        field: "payment",
      };
    }

    if (normalized.includes("cupom")) {
      return {
        interpretedAction: "Enviar sua resposta sobre cupom antes de escolher o pagamento.",
        riskLevel: "medium",
        field: "coupon",
      };
    }

    return {
      interpretedAction: "Enviar esta instrução de pagamento ao agente. Nenhuma cobrança acontece sem confirmação final.",
      riskLevel: "high",
      field: "payment",
    };
  }

  return {
    interpretedAction: "Enviar esta resposta ao agente para continuar a jornada.",
    riskLevel: "low",
    field: "generic",
  };
}

function riskLabel(risk: PendingVoiceTurn["riskLevel"]): string {
  if (risk === "high") return "Confirmação obrigatória";
  if (risk === "medium") return "Revisar antes de enviar";
  return "Baixo risco";
}

function VoiceConfirmationPanel({
  pendingTurn,
  busy,
  onConfirm,
  onRetry,
  onEditInChat,
}: {
  pendingTurn: PendingVoiceTurn;
  busy: boolean;
  onConfirm: () => void;
  onRetry: () => void;
  onEditInChat: () => void;
}) {
  return (
    <section
      className="aacp-voice-confirmation"
      data-risk={pendingTurn.riskLevel}
      aria-label="Confirmar resposta por voz"
    >
      <div className="aacp-voice-confirmation__header">
        <span className="aacp-voice-confirmation__icon" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <p className="aacp-voice-confirmation__eyebrow">{riskLabel(pendingTurn.riskLevel)}</p>
          <h2>Antes de enviar</h2>
        </div>
      </div>

      <dl className="aacp-voice-confirmation__review">
        <div>
          <dt>Você disse</dt>
          <dd>{pendingTurn.displayTranscript}</dd>
        </div>
        <div>
          <dt>Vou fazer</dt>
          <dd>{pendingTurn.interpretedAction}</dd>
        </div>
      </dl>

      <div className="aacp-voice-confirmation__actions">
        <button
          type="button"
          className="aacp-voice-confirmation__primary"
          onClick={onConfirm}
          disabled={busy}
        >
          <Check size={16} />
          Confirmar e enviar
        </button>
        <button
          type="button"
          className="aacp-voice-confirmation__secondary"
          onClick={onRetry}
          disabled={busy}
        >
          <RotateCcw size={15} />
          Falar de novo
        </button>
        <button
          type="button"
          className="aacp-voice-confirmation__quiet"
          onClick={onEditInChat}
          disabled={busy}
        >
          <Edit3 size={15} />
          Editar no chat
        </button>
      </div>
    </section>
  );
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
    buildPendingTurn: (text) => describePendingVoiceTurn(vm, text),
    onConfirmTranscript: (text) => vm.sendMessageWithOverride(text),
  });

  function switchToChat(): void {
    voice.stopAll();
    voice.discardPendingTurn();
    vm.selectPurchaseChannel("chat");
  }

  function editPendingTurnInChat(): void {
    if (voice.pendingTurn) {
      vm.setMessage(voice.pendingTurn.rawTranscript);
    }
    switchToChat();
  }

  const micDisabled = vm.busy || vm.composerLocked || voice.speaking || Boolean(voice.pendingTurn);
  const voiceState = voice.speaking
    ? "speaking"
    : voice.listening
      ? "listening"
      : voice.pendingTurn
        ? "confirming"
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

            {voice.pendingTurn ? (
              <VoiceConfirmationPanel
                pendingTurn={voice.pendingTurn}
                busy={vm.busy}
                onConfirm={() => void voice.confirmPendingTurn()}
                onRetry={voice.retryPendingTurn}
                onEditInChat={editPendingTurnInChat}
              />
            ) : null}

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
                  voice.pendingTurn
                    ? "Confirmação de voz pendente"
                    : voice.listening
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

            {!voice.pendingTurn && !vm.composerLocked && vm.quickReplies.length > 0 ? (
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
