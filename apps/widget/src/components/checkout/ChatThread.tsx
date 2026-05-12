import { CheckCircle2, Gift, Copy, Check, Truck, Tag } from "lucide-react";
import { CrossSellBanner } from "./CrossSellBanner.js";
import { CardForm } from "./CardForm.js";
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
  quickReplyId
} from "../../hooks/checkout-view-model.js";

export function ChatThread({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);

  return (
    <div className="aacp-thread" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      {vm.networkError ? <NetworkError vm={vm} /> : null}

      {vm.turns.map((turn, index) => {
        const key = bubbleKey(turn, index);
        return (
          <ChatBubble
            key={key}
            turn={turn}
            agentName={vm.activeExperience.agent.name}
            bubbleKey={key}
            streamingKey={vm.streamingTurnKey}
            onAgentTypingDone={vm.handleAgentTypingDone}
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

      {!vm.selectedShippingMethod && vm.shippingOptions.length > 0 && vm.checkoutStage === "shipping" ? (
        <ShippingSelector
          options={vm.shippingOptions}
          selectedMethod={vm.selectedShippingMethod}
          onSelect={(opt) => void vm.tapShippingOption(opt)}
          busy={vm.busy}
        />
      ) : null}

      {vm.suggestedProducts && vm.suggestedProducts.length > 0 && !vm.crossSellDismissed ? (
        <CrossSellBanner
          products={vm.suggestedProducts}
          currency={vm.visibleTotals.currency}
          onAdd={(p) => vm.addSuggestedProduct(p)}
          onDismiss={vm.dismissCrossSell}
        />
      ) : null}

      {vm.showCouponBox ? <CouponBox vm={vm} /> : null}

      {vm.showCardForm && vm.checkoutStage !== "completed" ? <CardForm vm={vm} /> : null}

      {(vm.showComposer || (vm.checkoutStage === "payment" && !vm.showCardForm)) && !vm.composerLocked && vm.quickReplies.length > 0 ? (
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

      {vm.showComposer && !vm.awaitingAgentPlayback && (
        <div className="aacp-thread-composer-wrap">
          <Composer vm={vm} />
        </div>
      )}

      {vm.checkoutStage === "completed" ? (
        <div className="aacp-offer" style={{ borderColor: "var(--aacp-success)", background: "rgba(16, 185, 129, 0.05)" }}>
          <div className="aacp-offer-icon" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--aacp-success)" }}>
            <CheckCircle2 size={18} />
          </div>
          <div className="aacp-offer-text">
            <strong>Pedido confirmado</strong>
            <span>{vm.lastChat?.message || "Seu pedido foi processado com sucesso!"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatBubble({
  turn,
  bubbleKey: key,
  streamingKey,
  onAgentTypingDone,
}: {
  turn: ChatTurn;
  agentName: string;
  bubbleKey: string;
  streamingKey: string | null;
  onAgentTypingDone?: (key: string) => void;
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const shouldStream = streamingKey !== null && key === streamingKey && turn.role === "agent";
  const { displayed, isStreaming } = useStreamedText(turn.text, {
    enabled: shouldStream,
    skipCompleteWhenDisabled: turn.role === "agent",
    onComplete: turn.role === "agent" ? () => onAgentTypingDone?.(key) : undefined
  });
  const showCaret = shouldStream && isStreaming;
  
  const pixMatch = displayed.match(/000201[a-zA-Z0-9.*]{40,}/);
  const pixCode = pixMatch ? pixMatch[0] : null;

  useEffect(() => {
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [displayed]);

  return (
    <div key={key} ref={bubbleRef} className={`aacp-bubble aacp-bubble-${turn.role} aacp-chat-bubble aacp-chat-bubble--${turn.role}`}>
      <span className="aacp-chat-text">{displayed}</span>
      {showCaret && <span className="chat-caret" aria-hidden="true" />}
      
      {pixCode && turn.role === "agent" && !showCaret ? (
        <div className="mt-4 p-4 bg-white rounded-xl flex flex-col items-center gap-3 text-slate-800">
          <QRCode value={pixCode} size={160} />
          <PixCopyButton pixCode={pixCode} />
        </div>
      ) : null}
    </div>
  );
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
      className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-full text-xs font-bold transition-colors w-full justify-center"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copiado!" : "Copiar código PIX"}
    </button>
  );
}

export function NetworkError({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-bubble aacp-bubble-agent" style={{ borderColor: "rgba(239, 68, 68, 0.2)", background: "rgba(239, 68, 68, 0.05)", color: "rgba(239, 68, 68, 0.8)" }}>
      {vm.networkError}
      <button type="button" className="font-bold underline ml-2" onClick={vm.retryStartCheckout}>
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
        className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 transition-opacity"
        style={{ background: "var(--aacp-grad-primary)" }}
      >
        Aplicar
      </button>
    </form>
  );
}

export function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-offer aacp-offer-banner">
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
        className="aacp-cta"
        onClick={() => void vm.continueToPayment()}
        disabled={vm.busy}
      >
        Continuar
      </button>
    </div>
  );
}
