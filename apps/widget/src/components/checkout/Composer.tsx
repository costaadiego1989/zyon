import { Send } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function Composer({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showComposer) return null;
  return (
    <div className="p-6 border-t border-white/5 bg-[#0f0d1a]/50 backdrop-blur-xl">
      <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-white/30" id="aacp-inline-composer-label">
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
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-purple-500/50 transition-all shadow-inner disabled:opacity-50"
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
          className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center hover:bg-purple-500 hover:scale-105 active:scale-95 transition-all shadow-lg disabled:bg-white/5 disabled:text-white/20 disabled:scale-100"
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
