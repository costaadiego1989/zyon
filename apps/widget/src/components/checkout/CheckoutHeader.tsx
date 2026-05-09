import { Smartphone, Sparkles } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, cn } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  return (
    <header className="p-6 border-b border-white/5 flex items-center justify-between">
      <div className="flex items-center gap-4 min-w-0">
        <div className="relative w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg overflow-hidden border border-white/10" aria-hidden="true">
          {vm.theme.agentAvatarUrl ? <img src={vm.theme.agentAvatarUrl} alt="" className="w-full h-full object-cover" /> : <Sparkles size={24} />}
          <span className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#1c1830] animate-pulse" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-black text-white tracking-tight">{agentName.given}</span>
            {agentName.rest ? (
              <>
                <span className="text-white/20 text-[10px]">•</span>
                <span className="text-[10px] font-black uppercase tracking-widest text-purple-400/80">{agentName.rest}</span>
              </>
            ) : (
              <span className="text-[10px] font-black uppercase tracking-widest text-purple-400/80">Assistente de Vendas</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            <span className="text-[11px] text-white/40 truncate">{vm.activeExperience.brand.name} · online · responde em segundos</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-3 p-2.5 pr-4 border border-purple-500/30 rounded-2xl bg-gradient-to-br from-purple-500/10 to-white/5 text-left transition hover:-translate-y-[1px] hover:border-purple-500/50 hover:from-purple-500/20 hover:to-white/10 hover:shadow-[0_18px_44px_rgba(168,85,247,0.24),inset_0_1px_0_rgba(255,255,255,0.1)] shadow-[0_14px_34px_rgba(168,85,247,0.18),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md max-w-[230px]"
          onClick={vm.auth.session ? vm.auth.openHub : vm.auth.openLogin}
        >
          <span className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 text-purple-400 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" aria-hidden="true">
            <Smartphone size={14} />
          </span>
          <span className="min-w-0">
            <strong className="block text-xs font-bold leading-tight truncate">{vm.auth.session ? "Minha conta" : "Entrar"}</strong>
            <em className="block mt-0.5 text-[9px] not-italic text-white/40 truncate tracking-tight">{vm.auth.session ? vm.auth.session.email : "Login por celular"}</em>
          </span>
        </button>
      </div>
    </header>
  );
}
