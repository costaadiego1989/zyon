import { CheckCircle2, Gift, Sparkles, Copy, Check } from "lucide-react";
import { CreditCardForm } from "./CreditCardForm.js";
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
  const isDark = vm.colorMode === "dark";
  return (
    <div className={cn(
      "flex-1 overflow-y-auto p-6 scroll-smooth aacp-scrollbar flex flex-col gap-6 transition-colors duration-300",
      isDark ? "bg-transparent" : "bg-gradient-to-b from-slate-50/50 to-white"
    )} ref={vm.threadRef} role="log" aria-live="polite" aria-label="Conversa">
      {vm.networkError ? <NetworkError vm={vm} /> : null}

      {vm.turns.map((turn, index) => {
        const key = bubbleKey(turn, index);
        return (
          <ChatBubble
            key={key}
            turn={turn}
            agentName={vm.activeExperience.agent.name}
            agentAvatarUrl={vm.theme.agentAvatarUrl}
            bubbleKey={key}
            streamingKey={vm.streamingTurnKey}
            onAgentTypingDone={vm.handleAgentTypingDone}
            isDark={isDark}
          />
        );
      })}

      {vm.busy ? (
        <div className={cn("flex items-center gap-3 text-xs px-1 aacp-typing", isDark ? "text-white/50" : "text-slate-400")} aria-label={agentTypingLine(vm.activeExperience.agent.name)}>
          <strong>{agentName.given}</strong> esta digitando
          <span className="flex gap-1 items-center" aria-hidden="true">
            <span className={cn("w-1 h-1 rounded-full animate-bounce", isDark ? "bg-white/40" : "bg-purple-400")} />
            <span className={cn("w-1 h-1 rounded-full animate-bounce [animation-delay:0.2s]", isDark ? "bg-white/40" : "bg-purple-400")} />
            <span className={cn("w-1 h-1 rounded-full animate-bounce [animation-delay:0.4s]", isDark ? "bg-white/40" : "bg-purple-400")} />
          </span>
        </div>
      ) : null}

      {vm.showOfferBanner ? <OfferBanner vm={vm} /> : null}

      {vm.showCardForm && vm.checkoutStage !== "completed" ? <CreditCardForm vm={vm} /> : null}

      {vm.showComposer && !vm.composerLocked && vm.quickReplies.length > 0 ? (
        <div className="flex flex-wrap gap-2 py-2 aacp-quick-replies aacp-quick-replies--in-thread" role="group" aria-label="Respostas sugeridas">
          {vm.quickReplies.map((reply) => (
            <button
              className={cn(
                "px-4 py-2 rounded-full border text-xs transition-all",
                isDark
                  ? "border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 hover:border-purple-500/30"
                  : "border-purple-200 bg-purple-50/50 text-purple-700 hover:bg-purple-100 hover:border-purple-400 hover:text-purple-800"
              )}
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
        <div className={cn(
          "p-5 rounded-3xl border flex gap-4 items-center",
          isDark
            ? "border-emerald-500/20 bg-emerald-500/5 shadow-[0_8px_32px_rgba(16,185,129,0.1)]"
            : "border-emerald-200 bg-emerald-50 shadow-sm"
        )} role="status">
          <CheckCircle2 className="text-emerald-500 shrink-0" size={24} aria-hidden="true" />
          <div className="min-w-0">
            <strong className={cn("block text-sm font-bold mb-1", isDark ? "text-emerald-100" : "text-emerald-800")}>Pedido confirmado</strong>
            <span className={cn("block text-xs leading-relaxed", isDark ? "text-emerald-400/80" : "text-emerald-600")}>
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
  agentAvatarUrl,
  bubbleKey: key,
  streamingKey,
  onAgentTypingDone,
  isDark = true
}: {
  turn: ChatTurn;
  agentName: string;
  agentAvatarUrl?: string;
  bubbleKey: string;
  streamingKey: string | null;
  onAgentTypingDone?: (key: string) => void;
  isDark?: boolean;
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
  
  const pixMatch = displayed.match(/000201[a-zA-Z0-9.*]{40,}/);
  const pixCode = pixMatch ? pixMatch[0] : null;

  useEffect(() => {
    if (typeof bubbleRef.current?.scrollIntoView !== "function") return;
    bubbleRef.current.scrollIntoView({ block: "end" });
  }, [displayed]);

  return (
    <div className={cn("flex items-end gap-3 max-w-[85%]", turn.role === "agent" ? "self-start aacp-chat-bubble--agent" : "self-end flex-row-reverse aacp-chat-bubble--buyer")}>
      {turn.role === "agent" ? (
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-lg overflow-hidden border mb-1",
          isDark ? "bg-[#1c1830] text-white border-white/10" : "bg-white text-purple-500 border-purple-200/50"
        )} aria-hidden="true">
          {agentAvatarUrl ? <img src={agentAvatarUrl} alt="" className="w-full h-full object-cover" /> : <Sparkles size={16} className="text-purple-400" />}
        </div>
      ) : null}
      <div
        ref={bubbleRef}
        className={cn(
          "relative p-4 rounded-2xl text-[14px] leading-relaxed shadow-sm",
          turn.role === "agent"
            ? isDark
              ? "bg-[#1c1830] text-[#f4f1ff] border border-white/5 rounded-bl-none"
              : "bg-white text-slate-700 border border-slate-200/60 rounded-bl-none shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
            : "bg-gradient-to-br from-[#7c3aed] via-[#a855f7] to-[#ec4899] text-white rounded-br-none shadow-[0_8px_20px_rgba(168,85,247,0.3)]"
        )}
      >
        {turn.role === "agent" ? (
          <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-2", isDark ? "text-purple-400/60" : "text-purple-500/70")}>{given}</div>
        ) : null}
        <span className="whitespace-pre-wrap aacp-chat-text">
          {displayed}
          {showCaret ? (
            <span className="inline-block w-1.5 h-4 bg-purple-400 ml-1 animate-pulse align-middle" aria-hidden="true" />
          ) : null}
        </span>
        {pixCode && turn.role === "agent" && !showCaret ? (
          <div className="mt-4 p-4 bg-white rounded-xl flex flex-col items-center gap-3">
            <QRCode value={pixCode} size={160} />
            <PixCopyButton pixCode={pixCode} />
          </div>
        ) : null}
      </div>
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
    <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs text-center flex flex-col gap-2" role="alert">
      <span>{vm.networkError}</span>
      <button type="button" className="font-bold underline hover:no-underline" onClick={vm.retryStartCheckout}>
        Tentar novamente
      </button>
    </div>
  );
}

export function OfferBanner({ vm }: { vm: CheckoutAgentViewModel }) {
  const isDark = vm.colorMode === "dark";
  return (
    <div className={cn(
      "p-5 rounded-3xl border flex items-center gap-4 transition-all",
      isDark
        ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-purple-500/10 shadow-[0_8px_32px_rgba(16,185,129,0.15)]"
        : "border-emerald-300/60 bg-gradient-to-br from-emerald-50 to-purple-50/30 shadow-sm"
    )} role="status">
      <div className={cn(
        "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
        isDark ? "bg-emerald-500/20 text-emerald-400" : "bg-emerald-100 text-emerald-600"
      )}>
        <Gift size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <strong className={cn("block text-sm font-bold mb-1", isDark ? "text-white" : "text-slate-800")}>Oferta aplicada</strong>
        <span className={cn("block text-xs", isDark ? "text-emerald-300/80" : "text-emerald-700")}>
          -{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)} · novo total{" "}
          <span className={cn("font-bold", isDark ? "text-white" : "text-slate-800")}>{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</span>
        </span>
      </div>
      <button
        className={cn(
          "px-5 py-2.5 rounded-xl text-xs font-bold shadow-lg hover:scale-105 transition-all disabled:opacity-50",
          isDark
            ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_8px_24px_rgba(16,185,129,0.3)]"
            : "bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-md"
        )}
        type="button"
        onClick={() => void vm.continueToPayment()}
        disabled={vm.busy}
      >
        Continuar
      </button>
    </div>
  );
}
