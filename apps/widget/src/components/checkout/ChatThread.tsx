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
import type { ChatTurn } from "@aacp/shared-types";
import { useStreamedText } from "../../hooks/use-streamed-text.js";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import {
  agentGivenAndRest,
  agentTypingLine,
  bubbleKey,
  cn,
  formatCurrency,
  stripAgentMessagePrefix,
} from "../../hooks/checkout-view-model.js";
import {
  selectCheckoutPanels,
  selectCouponBoxModel,
  selectNetworkErrorModel,
  selectOfferBannerModel,
  selectPendingOfferBannerModel,
} from "../../presentation/selectors/checkout-panels.selector.js";
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
import { quickReplyId } from "../../hooks/checkout-view-model.js";

export function ChatThread({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const stageLead = conversationLead(vm.checkoutStage);
  const latestAgentIndex = vm.turns.reduce(
    (latest, turn, index) => (turn.role === "agent" ? index : latest),
    -1,
  );
  const panels = selectCheckoutPanels(vm, { variant: "thread" });

  return (
    <div className="aacp-thread" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      <section className="aacp-conversation-lead" aria-labelledby="aacp-conversation-title">
        <div className="aacp-conversation-lead-copy">
          <span className="aacp-conversation-agent">Decisao atual</span>
          <h2 id="aacp-conversation-title">{stageLead.title}</h2>
          <p>{stageLead.description}</p>
        </div>
        <span className="aacp-conversation-orbit" aria-hidden="true">
          {vm.theme?.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" />
          ) : (
            <Bot size={22} />
          )}
        </span>
      </section>

      <div className="aacp-conversation-divider" aria-hidden="true" />

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
        <div className="aacp-typing" aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> está digitando
          <span className="aacp-dots"><span /><span /><span /></span>
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

      {panels.showCryptoPanel ? <CryptoPaymentPanel vm={vm} /> : null}

      {panels.quickReplies ? (
        <div
          className="aacp-quick-replies aacp-quick-replies--in-thread"
          role="group"
          aria-label="Respostas sugeridas"
        >
          {panels.quickReplies.items.map((reply) => (
            <button
              className="aacp-chip"
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

      {vm.showComposer && (
        <div className="aacp-thread-composer-wrap">
          <Composer vm={vm} />
        </div>
      )}

      {vm.checkoutStage === "completed" ? (
        <OrderConfirmation vm={vm} />
      ) : null}
    </div>
  );
}

function OrderConfirmation({ vm }: { vm: CheckoutAgentViewModel }) {
  const sessionRef = vm.session?.session_id?.slice(-6)?.toUpperCase() ?? "------";
  const summaryItems = vm.completedOrderSnapshot?.items ?? vm.visibleItems;
  const summaryTotals = vm.completedOrderSnapshot?.totals ?? vm.visibleTotals;
  const fallbackReturnUrl = typeof window !== "undefined" ? window.location.origin : undefined;
  const redirectUrl =
    vm.config.successRedirectUrl ||
    vm.config.storeUrl ||
    vm.config.emptyCartRedirectUrl ||
    fallbackReturnUrl;
  const redirectLabel = vm.config.successRedirectLabel || "Voltar para a loja";

  return (
    <section className="aacp-order-confirmation" aria-labelledby="aacp-order-confirmation-title">
      <div className="aacp-order-confirmation-head">
        <div className="aacp-order-confirmation-icon" aria-hidden="true">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <span className="aacp-order-confirmation-kicker">Pagamento aprovado</span>
          <h3 id="aacp-order-confirmation-title">Pedido confirmado</h3>
          <p>Enviaremos as atualizações de entrega e rastreio para sua conta.</p>
          <span className="aacp-order-confirmation-reference">Referência da sessão {sessionRef}</span>
        </div>
      </div>

      <div className="aacp-order-confirmation-summary">
        <h4>Resumo do pedido</h4>
        <div className="aacp-order-confirmation-lines">
          {summaryItems.map((item) => (
            <div key={item.sku}>
              <span>{item.quantity}x {item.name}</span>
              <strong>{formatCurrency(item.line_total, summaryTotals.currency)}</strong>
            </div>
          ))}
          {summaryTotals.shipping > 0 && (
            <div>
              <span>Frete</span>
              <strong>{formatCurrency(summaryTotals.shipping, summaryTotals.currency)}</strong>
            </div>
          )}
          {summaryTotals.discount > 0 && (
            <div className="is-discount">
              <span>Desconto</span>
              <strong>-{formatCurrency(summaryTotals.discount, summaryTotals.currency)}</strong>
            </div>
          )}
          <div className="aacp-order-confirmation-total">
            <span>Total</span>
            <strong>{formatCurrency(summaryTotals.total, summaryTotals.currency)}</strong>
          </div>
        </div>
      </div>

      {redirectUrl && (
        <a
          href={redirectUrl}
          target="_top"
          className="aacp-cta aacp-order-confirmation-action"
          data-testid="return-to-store"
        >
          {redirectLabel}
          <ExternalLink size={14} />
        </a>
      )}
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
      className={`aacp-bubble aacp-bubble-${turn.role} aacp-chat-bubble aacp-chat-bubble--${turn.role}${isLatest ? " is-latest" : ""}`}
    >
      <span className="aacp-chat-text">{displayed}</span>
      {showCaret && <span className="chat-caret" aria-hidden="true" />}

      {pixCode && isAgent && !showCaret ? (
        <div className="aacp-pix-panel">
          <QRCode value={pixCode} size={160} />
          <PixCopyButton pixCode={pixCode} />
        </div>
      ) : null}
    </div>
  );

  if (!isAgent) {
    return (
      <div key={key} ref={bubbleRef} className="aacp-bubble-stack aacp-bubble-stack--buyer">
        {bubbleBody}
      </div>
    );
  }

  return (
    <div
      key={key}
      ref={bubbleRef}
      className={`aacp-bubble-stack aacp-bubble-stack--agent${isLatest ? " is-active-turn" : ""}`}
    >
      <div className="aacp-bubble-meta" aria-hidden="true">
        <span className="aacp-bubble-meta-avatar">
          {agentAvatarUrl ? (
            <img src={agentAvatarUrl} alt="" />
          ) : (
            <Bot size={16} strokeWidth={2} />
          )}
        </span>
        <span className="aacp-bubble-meta-name">{given || agentName}</span>
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
    <button type="button" onClick={handleCopy} className="aacp-pix-copy">
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copiado!" : "Copiar código PIX"}
    </button>
  );
}

export function NetworkError({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectNetworkErrorModel(vm);
  if (!model) return null;
  return <NetworkErrorView model={model} />;
}

export function CouponBox({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectCouponBoxModel(vm);
  if (!model) return null;
  return <CouponBoxView model={model} />;
}

export function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectOfferBannerModel(vm);
  if (!model) return null;
  return <OfferBannerView model={model} />;
}

export function PendingOfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  const model = selectPendingOfferBannerModel(vm);
  if (!model) return null;
  return <PendingOfferBannerView model={model} />;
}
