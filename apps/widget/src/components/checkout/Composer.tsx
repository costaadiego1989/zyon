import { Send } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn } from "../../hooks/checkout-view-model.js";

export function Composer({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showComposer) return null;
  const isDark = vm.colorMode === "dark";

  return (
    <div className={cn("p-6 border-t", isDark ? "border-white/5 bg-[#0f0d1a]/50 backdrop-blur-xl" : "border-slate-200 bg-white/80 backdrop-blur-xl")}>
      <div className={cn("mb-2 px-1 text-[10px] font-bold uppercase tracking-widest", isDark ? "text-white/30" : "text-slate-400")} id="aacp-inline-composer-label">
        {vm.activeExperience.copy.expected_input_type === "email"
          ? "Digite seu e-mail para avançar"
          : vm.activeExperience.copy.expected_input_type === "tel"
            ? "Digite seu telefone com DDD"
            : vm.activeExperience.copy.expected_input_type === "number"
              ? "Digite o dado solicitado apenas com números"
              : "Sua vez - quando quiser, responda"}
      </div>
      <form
        className="relative flex items-center"
        aria-labelledby="aacp-inline-composer-label"
        onSubmit={(event) => {
          event.preventDefault();
          void vm.sendMessage();
        }}
      >
        <input
          className={cn(
            "w-full rounded-2xl px-5 py-4 text-sm transition-all shadow-inner disabled:opacity-50 focus:outline-none",
            isDark
              ? "bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-purple-500/50"
              : "bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-400 focus:bg-white"
          )}
          ref={vm.composerInputRef}
          value={vm.message}
          onChange={(event) => vm.setMessage(event.target.value)}
          placeholder={
            vm.checkoutStage === "payment"
              ? "Prefiro PIX"
              : vm.checkoutStage === "shipping"
                ? "Digite o CEP ou número"
                : "Escreva sua mensagem..."
          }
          aria-label="Mensagem para o assistente"
          autoComplete="off"
          disabled={vm.composerLocked}
          type={
            vm.activeExperience.copy.expected_input_type === "email"
              ? "email"
              : vm.activeExperience.copy.expected_input_type === "tel"
                ? "tel"
                : "text"
          }
          inputMode={vm.activeExperience.copy.expected_input_type === "number" ? "numeric" : undefined}
          pattern={vm.activeExperience.copy.expected_input_type === "number" ? "[0-9]*" : undefined}
        />
        <button
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:scale-100",
            isDark
              ? "bg-purple-600 text-white hover:bg-purple-500 hover:scale-105 active:scale-95 shadow-lg disabled:bg-white/5 disabled:text-white/20"
              : "bg-purple-600 text-white hover:bg-purple-700 hover:scale-105 active:scale-95 shadow-md disabled:bg-slate-100 disabled:text-slate-300"
          )}
          type="submit"
          aria-label="Enviar mensagem"
          disabled={vm.composerLocked || !vm.message.trim()}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
