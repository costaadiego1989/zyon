import {
  Bot,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { Composer } from "./Composer.js";
import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { ChatTurn } from "@zyon/shared-types";
import { useStreamedText } from "../../hooks/use-streamed-text.js";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import {
  agentGivenAndRest,
  agentTypingLine,
  bubbleKey,
  cn,
  stripAgentMessagePrefix,
} from "../../hooks/checkout-presentation.js";
import {
  selectCheckoutPanels,
} from "../../presentation/selectors/checkout-panels.selector.js";
import { selectComposerModel } from "../../presentation/selectors/composer.selector.js";
import { selectOrderConfirmationModel } from "../../presentation/selectors/order-confirmation.selector.js";
import type { OrderConfirmationModel } from "../../presentation/models/order-confirmation.model.js";
import {
  CouponBoxView,
  NetworkErrorView,
  OfferBannerView,
  PendingOfferBannerView,
} from "../../features/conversation/CheckoutActionPanels.js";
import { CrossSellBanner } from "./CrossSellBanner.js";
import { ProductSearchResults } from "./ProductSearchResults.js";
import { CreditCardForm } from "./CreditCardForm.js";
import { CryptoPaymentPanel } from "./CryptoPaymentPanel.js";
import { ShippingSelector } from "./ShippingSelector.js";
import { PulseHero } from "../../features/pulse/PulseHero.js";
import { quickReplyId } from "../../hooks/checkout-presentation.js";

const THREAD_PANEL_OPTIONS = { variant: "thread" } as const;

export function ChatThread({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const stageLead = conversationLead(vm.checkoutStage);
  const latestAgentIndex = vm.turns.reduce(
    (latest, turn, index) => (turn.role === "agent" ? index : latest),
    -1,
  );
  const panels = selectCheckoutPanels(vm, THREAD_PANEL_OPTIONS);
  const composer = selectComposerModel(vm);
  const showPulseHero =
    vm.checkoutStage === "data_collection" &&
    !vm.turns.some((turn) => turn.role === "buyer");

  return (
    <div className="zyon-thread" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      <section className="zyon-conversation-lead" aria-labelledby="zyon-conversation-title">
        <div className="zyon-conversation-lead-copy">
          <span className="zyon-conversation-agent">Decisao atual</span>
          <h2 id="zyon-conversation-title">{stageLead.title}</h2>
          <p>{stageLead.description}</p>
        </div>
        <span className="zyon-conversation-orbit" aria-hidden="true">
          {vm.theme?.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" />
          ) : (
            <Bot size={22} />
          )}
        </span>
      </section>

      <div className="zyon-conversation-divider" aria-hidden="true" />

      {showPulseHero ? <PulseHero vm={vm} /> : null}

      {panels.networkError ? <NetworkErrorView model={panels.networkError} /> : null}

      {vm.turns.map((turn, index) => {
        const key = bubbleKey(turn, index);
        return (
          <ChatBubble
            key={key}
            turn={turn}
            agentName={vm.theme?.agentName || vm.activeExperience.agent.name}
            agentAvatarUrl={vm.theme?.agentAvatarUrl}
            bubbleKey={key}
            streamingKey={vm.streamingTurnKey}
            onAgentTypingDone={vm.handleAgentTypingDone}
            isLatest={index === latestAgentIndex}
            autoScroll={vm.turns.length > 2 && index === latestAgentIndex}
          />
        );
      })}

      {vm.busy ? (
        <div className="zyon-typing" aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> está digitando
          <span className="zyon-dots"><span /><span /><span /></span>
        </div>
      ) : null}

      {panels.offerBanner ? <OfferBannerView model={panels.offerBanner} /> : null}

      {panels.shipping ? (
        <ShippingSelector
          options={panels.shipping.options}
          selectedMethod={panels.shipping.selectedMethod}
          onSelect={(opt) => void panels.shipping!.onSelect(opt)}
          busy={panels.shipping.busy}
        />
      ) : null}

      {panels.catalogResults ? (
        <ProductSearchResults
          products={panels.catalogResults.products}
          currency={panels.catalogResults.currency}
          onAdd={panels.catalogResults.onAdd}
        />
      ) : null}

      {panels.crossSell ? (
        <CrossSellBanner
          products={panels.crossSell.products}
          currency={panels.crossSell.currency}
          onAdd={panels.crossSell.onAdd}
          onDismiss={panels.crossSell.onDismiss}
          onProceedToPayment={panels.crossSell.onProceedToPayment}
        />
      ) : null}

      {panels.pendingOffer ? <PendingOfferBannerView model={panels.pendingOffer} /> : null}

      {panels.couponBox ? <CouponBoxView model={panels.couponBox} /> : null}

      {panels.creditCardForm ? <CreditCardForm model={panels.creditCardForm} /> : null}

      {panels.cryptoPanel ? <CryptoPaymentPanel model={panels.cryptoPanel} /> : null}

      {panels.quickReplies ? (
        <div
          className="zyon-quick-replies zyon-quick-replies--in-thread"
          role="group"
          aria-label="Respostas sugeridas"
        >
          {panels.quickReplies.items.map((reply) => (
            <button
              className="zyon-chip"
              key={quickReplyId(reply)}
              type="button"
              onClick={() => void panels.quickReplies!.onTap(reply)}
              disabled={panels.quickReplies?.disabled}
            >
              {reply.label}
            </button>
          ))}
        </div>
      ) : null}

      {composer ? (
        <div className="zyon-thread-composer-wrap">
          <Composer model={composer} />
        </div>
      ) : null}

      {vm.checkoutStage === "completed" ? (
        <OrderConfirmationView model={selectOrderConfirmationModel(vm)} />
      ) : null}
    </div>
  );
}

export function OrderConfirmationView({ model }: { model: OrderConfirmationModel }) {
  return (
    <section className="zyon-order-confirmation" aria-labelledby="zyon-order-confirmation-title">
      <div className="zyon-order-confirmation-head">
        <div className="zyon-order-confirmation-icon" aria-hidden="true">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <span className="zyon-order-confirmation-kicker">Pagamento aprovado</span>
          <h3 id="zyon-order-confirmation-title">Pedido confirmado</h3>
          <p>Enviaremos as atualizações de entrega e rastreio para sua conta.</p>
          <span className="zyon-order-confirmation-reference">Referência da sessão {model.sessionRef}</span>
        </div>
      </div>

      <div className="zyon-order-confirmation-summary">
        <h4>Resumo do pedido</h4>
        <div className="zyon-order-confirmation-lines">
          {model.lines.map((line) => (
            <div
              key={line.key}
              className={
                line.variant === "discount"
                  ? "is-discount"
                  : line.variant === "total"
                    ? "zyon-order-confirmation-total"
                    : undefined
              }
            >
              <span>{line.label}</span>
              <strong>{line.amountLabel}</strong>
            </div>
          ))}
        </div>
      </div>

      {model.redirectUrl ? (
        <a
          href={model.redirectUrl}
          target="_top"
          className="zyon-cta zyon-order-confirmation-action"
          data-testid="return-to-store"
        >
          {model.redirectLabel}
          <ExternalLink size={14} />
        </a>
      ) : null}
    </section>
  );
}

export function ChatBubble({
  turn,
  bubbleKey: key,
  streamingKey,
  onAgentTypingDone,
  isLatest = false,
  autoScroll = false,
  agentName,
  agentAvatarUrl,
}: {
  turn: ChatTurn;
  agentName: string;
  agentAvatarUrl?: string;
  bubbleKey: string;
  streamingKey: string | null;
  onAgentTypingDone?: (key: string) => void;
  isLatest?: boolean;
  autoScroll?: boolean;
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const isAgent = turn.role === "agent";
  const messageText = isAgent ? stripAgentMessagePrefix(turn.text, agentName) : turn.text;
  const shouldStream = streamingKey !== null && key === streamingKey && isAgent;
  const { displayed, isStreaming } = useStreamedText(messageText, {
    enabled: shouldStream,
    skipCompleteWhenDisabled: isAgent,
    onComplete: isAgent ? () => onAgentTypingDone?.(key) : undefined,
  });
  const showCaret = shouldStream && isStreaming;
  const { given } = agentGivenAndRest(agentName);

  const pixMatch = displayed.match(/000201[a-zA-Z0-9.*]{40,}/);
  const pixCode = pixMatch ? pixMatch[0] : null;

  useEffect(() => {
    if (!autoScroll || !isStreaming) return;
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [autoScroll, displayed, isStreaming]);

  const bubbleBody = (
    <div
      ref={isAgent ? undefined : bubbleRef}
      className={`zyon-bubble zyon-bubble-${turn.role} zyon-chat-bubble zyon-chat-bubble--${turn.role}${isLatest ? " is-latest" : ""}`}
    >
      <span className="zyon-chat-text">{displayed}</span>
      {showCaret && <span className="chat-caret" aria-hidden="true" />}

      {pixCode && isAgent && !showCaret ? (
        <div className="zyon-pix-panel">
          <QRCode value={pixCode} size={160} />
          <PixCopyButton pixCode={pixCode} />
        </div>
      ) : null}
    </div>
  );

  if (!isAgent) {
    return (
      <div key={key} ref={bubbleRef} className="zyon-bubble-stack zyon-bubble-stack--buyer">
        {bubbleBody}
      </div>
    );
  }

  return (
    <div
      key={key}
      ref={bubbleRef}
      className={`zyon-bubble-stack zyon-bubble-stack--agent${isLatest ? " is-active-turn" : ""}`}
    >
      <div className="zyon-bubble-meta" aria-hidden="true">
        <span className="zyon-bubble-meta-avatar">
          {agentAvatarUrl ? (
            <img src={agentAvatarUrl} alt="" />
          ) : (
            <Bot size={16} strokeWidth={2} />
          )}
        </span>
        <span className="zyon-bubble-meta-name">{given || agentName}</span>
      </div>
      {bubbleBody}
    </div>
  );
}

function conversationLead(stage: string): { title: string; description: string } {
  if (stage === "completed") {
    return {
      title: "Pedido confirmado",
      description: "Confira os detalhes e acompanhe os próximos passos pela sua conta.",
    };
  }
  if (stage === "payment") {
    return {
      title: "Escolha como quer pagar.",
      description: "Revise o total antes de confirmar. Nenhuma cobrança acontece sem sua ação.",
    };
  }
  if (stage === "shipping") {
    return {
      title: "Como prefere receber?",
      description: "Escolha o endereço e a opção de frete que funcionam melhor para você.",
    };
  }
  return {
    title: "Vamos finalizar sua compra.",
    description: "Uma pergunta de cada vez. O pedido permanece visível enquanto avançamos.",
  };
}

function PixCopyButton({ pixCode }: { pixCode: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" onClick={handleCopy} className="zyon-pix-copy">
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copiado!" : "Copiar código PIX"}
    </button>
  );
}
