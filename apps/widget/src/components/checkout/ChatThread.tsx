import { CheckCircle2, Gift } from "lucide-react";
import { useEffect, useRef } from "react";
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
    <div className="flex-1 overflow-y-auto p-6 scroll-smooth aacp-scrollbar flex flex-col gap-6" ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
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
        <div className="flex items-center gap-3 text-white/50 text-xs px-1" aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> esta digitando
          <span className="flex gap-1 items-center" aria-hidden="true">
            <span className="w-1 h-1 rounded-full bg-white/40 animate-bounce" />
            <span className="w-1 h-1 rounded-full bg-white/40 animate-bounce [animation-delay:0.2s]" />
            <span className="w-1 h-1 rounded-full bg-white/40 animate-bounce [animation-delay:0.4s]" />
          </span>
        </div>
      ) : null}

      {vm.showOfferBanner ? <OfferBanner vm={vm} /> : null}

      {vm.showComposer && !vm.composerLocked && vm.quickReplies.length > 0 ? (
        <div className="flex flex-wrap gap-2 py-2" role="group" aria-label="Respostas sugeridas">
          {vm.quickReplies.map((reply) => (
            <button
              className="px-4 py-2 rounded-full border border-white/10 bg-white/5 text-xs text-white/70 hover:text-white hover:bg-white/10 hover:border-purple-500/30 transition-all"
              key={quickReplyId(reply)}
              type="button"
              onClick={() => void vm.tapQuick(reply)}
            >
              {reply.label}
            </button>
          ))}
        </div>
      ) : null}

      {vm.checkoutStage === "completed" ? (
        <div className="p-5 rounded-3xl border border-emerald-500/20 bg-emerald-500/5 flex gap-4 items-center shadow-[0_8px_32px_rgba(16,185,129,0.1)]" role="status">
          <CheckCircle2 className="text-emerald-400 shrink-0" size={24} aria-hidden="true" />
          <div className="min-w-0">
            <strong className="block text-sm text-emerald-100 font-bold mb-1">Pedido confirmado</strong>
            <span className="block text-xs text-emerald-400/80 leading-relaxed">
              {vm.lastChat?.message ??
                "Seu pedido foi confirmado. Voce recebera os detalhes, o codigo de rastreio e o resumo do checkout."}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ChatBubble({
  turn,
  agentName,
  bubbleKey: key,
  streamingKey,
  onAgentTypingDone
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
  const { given } = agentGivenAndRest(agentName);

  useEffect(() => {
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [displayed]);

  return (
    <div
      ref={bubbleRef}
      className={cn(
        "relative max-w-[85%] p-4 rounded-2xl text-[14px] leading-relaxed shadow-sm",
        turn.role === "agent"
          ? "bg-[#1c1830] text-[#f4f1ff] border border-white/5 rounded-bl-none self-start"
          : "bg-gradient-to-br from-[#7c3aed] via-[#a855f7] to-[#ec4899] text-white rounded-br-none self-end shadow-[0_8px_20px_rgba(168,85,247,0.3)]"
      )}
    >
      {turn.role === "agent" ? (
        <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400/60 mb-2">{given}</div>
      ) : null}
      <span className="whitespace-pre-wrap">
        {displayed}
        {showCaret ? (
          <span className="inline-block w-1.5 h-4 bg-purple-400 ml-1 animate-pulse align-middle" aria-hidden="true" />
        ) : null}
      </span>
    </div>
  );
}

export function NetworkError({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs text-center flex flex-col gap-2" role="alert">
      <span>{vm.networkError}</span>
      <button type="button" className="font-bold underline hover:no-underline" onClick={vm.retryStartCheckout}>
        Tentar novamente
      </button>
    </div>
  );
}

export function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="p-5 rounded-3xl border border-purple-500/30 bg-gradient-to-br from-purple-500/20 to-pink-500/10 flex items-center gap-4 shadow-[0_8px_32px_rgba(168,85,247,0.2)]" role="status">
      <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-purple-400 shrink-0 shadow-inner">
        <Gift size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <strong className="block text-sm text-white font-bold mb-1">Oferta aplicada</strong>
        <span className="block text-xs text-purple-300/80">
          -{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)} · novo total{" "}
          <span className="text-white font-bold">{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</span>
        </span>
      </div>
      <button
        className="px-5 py-2.5 rounded-xl bg-white text-[#7c3aed] text-xs font-bold shadow-lg hover:scale-105 transition-transform"
        type="button"
        onClick={() => void vm.continueToPayment()}
        disabled={vm.busy}
      >
        Continuar
      </button>
    </div>
  );
}
