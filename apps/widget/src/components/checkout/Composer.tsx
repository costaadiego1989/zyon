import { Send, Sparkles } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest } from "../../hooks/checkout-view-model.js";

export function Composer({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showComposer) return null;

  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);

  return (
    <div className="aacp-composer-wrap">
      <div className="aacp-composer-inline">
        <div className="aacp-agent-tag" aria-hidden="true">
          <Sparkles size={12} />
          {agentName.given} · IA
        </div>
        
        <form
          className="aacp-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void vm.sendMessage();
          }}
        >
          <input
            ref={vm.composerInputRef}
            className="aacp-input"
            type="text"
            placeholder={vm.busy ? "Aguarde..." : "Sua vez - quando quiser, responda"}
            value={vm.message}
            onChange={(e) => vm.setMessage(e.target.value)}
            disabled={vm.composerLocked}
            aria-label="Mensagem"
            autoComplete="off"
          />
          <button
            type="submit"
            className="aacp-send"
            disabled={!vm.message.trim() || vm.composerLocked}
            aria-label="Enviar"
          >
            <Send size={18} />
          </button>
        </form>

        <div className="aacp-composer-hint-inline" aria-hidden="true">
          <Sparkles size={11} />
          Pressione Enter para enviar
        </div>
      </div>
    </div>
  );
}
