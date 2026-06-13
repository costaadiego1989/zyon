import { Bot, CheckCircle2, Gift, Copy, Check, Truck, Tag, ExternalLink } from "lucide-react";
import { CrossSellBanner } from "./CrossSellBanner.js";
import { ProductSearchResults } from "./ProductSearchResults.js";
import { CreditCardForm } from "./CreditCardForm.js";
import { CryptoPaymentPanel } from "./CryptoPaymentPanel.js";
import { ShippingSelector } from "./ShippingSelector.js";
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
  quickReplyId,
  stripAgentMessagePrefix
} from "../../hooks/checkout-view-model.js";

export function ChatThread({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const stageLead = conversationLead(vm.checkoutStage);

  return (
    <div className="aacp-thread" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      <section className="aacp-conversation-lead" aria-labelledby="aacp-conversation-title">
        <span className="aacp-conversation-avatar" aria-hidden="true">
          {vm.theme?.agentAvatarUrl ? (
            <img src={vm.theme.agentAvatarUrl} alt="" />
          ) : (
            <Bot size={20} />
          )}
        </span>
        <div>
          <span className="aacp-conversation-agent">
            {agentName.given}, agente de compras
          </span>
          <h2 id="aacp-conversation-title">{stageLead.title}</h2>
          <p>{stageLead.description}</p>
        </div>
      </section>

      {vm.networkError ? <NetworkError vm={vm} /> : null}

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
            isLatest={index === vm.turns.length - 1}
          />
        );
      })}

      {vm.busy ? (
        <div className="aacp-typing" aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> está digitando
          <span className="aacp-dots"><span /><span /><span /></span>
        </div>
      ) : null}

      {vm.showOfferBanner ? <OfferBanner vm={vm} /> : null}

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

      {vm.isCartEmpty && vm.catalogResults.length > 0 ? (
        <ProductSearchResults
          products={vm.catalogResults}
          currency={vm.visibleTotals.currency}
          onAdd={vm.addCatalogProduct}
        />
      ) : null}

      {vm.suggestedProducts && vm.suggestedProducts.length > 0 && !vm.crossSellDismissed ? (
        <CrossSellBanner
          products={vm.suggestedProducts}
          currency={vm.visibleTotals.currency}
          onAdd={(p) => vm.addSuggestedProduct(p)}
          onDismiss={vm.dismissCrossSell}
          onProceedToPayment={vm.proceedFromCrossSell}
        />
      ) : null}

      {vm.showPendingOffer ? <PendingOfferBanner vm={vm} /> : null}

      {vm.showCouponBox ? <CouponBox vm={vm} /> : null}

      {vm.showCardForm && vm.checkoutStage !== "completed" ? <CreditCardForm vm={vm} /> : null}

      {vm.showCryptoPanel && vm.cryptoPayment && vm.checkoutStage !== "completed" ? (
        <CryptoPaymentPanel vm={vm} />
      ) : null}

      {(vm.showComposer || (vm.checkoutStage === "payment" && !vm.showCardForm && !vm.showCryptoPanel)) && !vm.composerLocked && vm.quickReplies.length > 0 ? (
        <div className="aacp-quick-replies aacp-quick-replies--in-thread" role="group" aria-label="Respostas sugeridas">
          {vm.quickReplies.map((reply) => (
            <button
              className="aacp-chip"
              key={quickReplyId(reply)}
              type="button"
              onClick={() => void vm.tapQuick(reply)}
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
  const orderRef = vm.session?.session_id?.slice(-6)?.toUpperCase() ?? "------";
  const summaryItems = vm.completedOrderSnapshot?.items ?? vm.visibleItems;
  const summaryTotals = vm.completedOrderSnapshot?.totals ?? vm.visibleTotals;
  const fallbackReturnUrl = typeof window !== "undefined" ? window.location.origin : undefined;
  const redirectUrl = vm.config.successRedirectUrl || vm.config.storeUrl || vm.config.emptyCartRedirectUrl || fallbackReturnUrl;
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
          <span className="aacp-order-confirmation-reference">Pedido #{orderRef}</span>
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
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const isAgent = turn.role === "agent";
  const messageText = isAgent ? stripAgentMessagePrefix(turn.text, agentName) : turn.text;
  const shouldStream = streamingKey !== null && key === streamingKey && isAgent;
  const { displayed, isStreaming } = useStreamedText(messageText, {
    enabled: shouldStream,
    skipCompleteWhenDisabled: isAgent,
    onComplete: isAgent ? () => onAgentTypingDone?.(key) : undefined
  });
  const showCaret = shouldStream && isStreaming;
  const { given } = agentGivenAndRest(agentName);
  
  const pixMatch = displayed.match(/000201[a-zA-Z0-9.*]{40,}/);
  const pixCode = pixMatch ? pixMatch[0] : null;

  useEffect(() => {
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [displayed]);

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
    <div key={key} ref={bubbleRef} className="aacp-bubble-stack aacp-bubble-stack--agent">
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
      title: "Escolha como pagar",
      description: "Revise o total antes de confirmar. Nenhuma cobrança acontece sem sua ação.",
    };
  }
  if (stage === "shipping") {
    return {
      title: "Vamos definir a entrega",
      description: "Escolha o endereço e a opção de frete que funcionam melhor para você.",
    };
  }
  return {
    title: "Vamos finalizar seu pedido",
    description: "Responda uma etapa por vez. Você pode revisar o resumo a qualquer momento.",
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
    <button
      type="button"
      onClick={handleCopy}
      className="aacp-pix-copy"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copiado!" : "Copiar código PIX"}
    </button>
  );
}

export function NetworkError({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-network-error" role="alert">
      <span>{vm.networkError}</span>
      <button type="button" onClick={vm.retryStartCheckout}>
        Tentar novamente
      </button>
    </div>
  );
}

export function CouponBox({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <form
      className="aacp-coupon-box mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void vm.submitCoupon();
      }}
    >
      <div className="relative flex-1">
        <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--aacp-muted)]" aria-hidden="true" />
        <input
          className="w-full rounded-xl border border-[var(--aacp-line)] bg-[var(--aacp-surface-2)] pl-9 pr-3 py-2.5 text-sm text-[var(--aacp-fg)] placeholder:text-[var(--aacp-muted)] focus:outline-none focus:border-[var(--aacp-accent)]"
          value={vm.coupon}
          onChange={(e) => vm.setCoupon(e.target.value)}
          placeholder="Código do cupom"
          aria-label="Cupom de desconto"
          disabled={vm.busy}
          autoComplete="off"
        />
      </div>
      <button
        type="submit"
        disabled={!vm.coupon.trim() || vm.busy}
        className="aacp-coupon-submit"
      >
        Aplicar
      </button>
    </form>
  );
}

export function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-offer aacp-offer-banner aacp-offer-banner--applied">
      <div className="aacp-offer-icon">
        <Gift size={18} />
      </div>
      <div className="aacp-offer-text">
        <strong>Oferta aplicada</strong>
        <span>
          -{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)} · novo total{" "}
          <b>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</b>
        </span>
      </div>
      <button
        type="button"
        className="aacp-offer-cta"
        onClick={() => void vm.continueToPayment()}
        disabled={vm.busy}
      >
        Continuar
      </button>
    </div>
  );
}

export function PendingOfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  const offer = vm.offer;
  if (!offer?.approved) return null;
  const pct = offer.type === "discount_percent" ? offer.value : 0;
  const savingsLabel =
    pct > 0
      ? `${pct}% de desconto`
      : offer.type === "shipping_free"
        ? "frete grátis"
        : "condição especial";

  return (
    <div className="aacp-offer aacp-offer-banner aacp-pending-offer">
      <div className="aacp-offer-icon aacp-pending-offer-icon">
        <Gift size={20} />
      </div>
      <div className="aacp-offer-text">
        <strong>Oferta exclusiva para você</strong>
        <span>
          Preparamos {savingsLabel} se você finalizar agora. Aproveite antes de pagar.
        </span>
      </div>
      <button
        type="button"
        className="aacp-offer-cta aacp-pending-offer-cta"
        onClick={() => void vm.applyOffer()}
        disabled={vm.busy}
      >
        Aplicar oferta
      </button>
    </div>
  );
}
