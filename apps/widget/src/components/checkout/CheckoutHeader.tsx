import { LogIn, Moon, ShoppingBag, Sparkles, Sun, User } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest, cn, formatCurrency } from "../../hooks/checkout-view-model.js";

export function CheckoutHeader({ vm }: { vm: CheckoutAgentViewModel }) {
  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const isDark = vm.colorMode === "dark";
  return (
    <header className={cn(
      "px-8 border-b flex items-center justify-between h-[100px] shrink-0 transition-colors duration-300 aacp-shell-header",
      isDark
        ? "border-white/5 bg-gradient-to-r from-[#0c0a16] via-[#14122b] to-[#0c0a16]"
        : "border-slate-200/60 bg-gradient-to-r from-white via-purple-50/20 to-white"
    )}>
      <div className="flex items-center gap-5 min-w-0">
        <div className="relative group shrink-0">
          <div className="absolute -inset-1 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl blur opacity-40 group-hover:opacity-60 transition duration-500"></div>
          <div className={cn(
            "relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl overflow-hidden border",
            isDark ? "bg-[#1c1830] text-white border-white/10" : "bg-white text-purple-600 border-purple-200/50"
          )} aria-hidden="true">
            {vm.theme.agentAvatarUrl ? <img src={vm.theme.agentAvatarUrl} alt="" className="w-full h-full object-cover" /> : <Sparkles size={28} className="text-purple-500" />}
            <div className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#1c1830] shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-lg font-black tracking-tight", isDark ? "text-white" : "text-slate-800")}>{agentName.given}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-500">{agentName.rest || "Assistente de Vendas"}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className={cn("text-[10px] font-bold uppercase tracking-[0.15em] truncate", isDark ? "text-white/30" : "text-slate-400")}>
              {vm.activeExperience.brand.name} · ONLINE · RESPONDE EM SEGUNDOS
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">

        <button
          type="button"
          className={cn(
            "h-10 w-10 flex items-center justify-center rounded-xl border transition-all hover:scale-105 active:scale-95",
            isDark
              ? "border-white/10 bg-white/5 text-yellow-400 hover:bg-white/10"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
          )}
          onClick={vm.toggleColorMode}
          aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
          title={isDark ? "Tema claro" : "Tema escuro"}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          type="button"
          id="aacp-login-btn"
          className={cn(
            "h-12 px-5 flex items-center gap-3 border rounded-xl transition active:scale-[0.98] group aacp-google-login",
            isDark
              ? "border-white/10 bg-white/5 text-white hover:bg-white/10 hover:border-white/20"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-purple-300"
          )}
          onClick={vm.auth.session ? vm.auth.openHub : vm.auth.openLogin}
        >
          {vm.auth.session || vm.activeExperience?.customer?.email_verified ? (
            <User size={18} className="text-purple-500" />
          ) : (
            <LogIn size={18} className="text-purple-500" />
          )}
          <div className="flex flex-col items-start leading-none">
            <span className="text-[13px] font-black tracking-tight">
              {vm.auth.session
                ? "Minha conta"
                : vm.activeExperience?.customer?.email_verified
                  ? `Olá, ${vm.activeExperience.customer.fullName ? vm.activeExperience.customer.fullName.split(" ")[0] : "Cliente"}`
                  : "Entrar"}
            </span>
            <span className={cn("text-[9px] font-bold uppercase mt-0.5 tracking-wider", isDark ? "text-white/30" : "text-slate-400")}>
              {vm.auth.session ? "Merchant" : vm.activeExperience?.customer?.email_verified ? "Cliente" : "Login"}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={cn(
            "h-12 px-5 flex items-center gap-3 border rounded-xl transition active:scale-[0.98]",
            isDark
              ? "border-white/10 bg-white/5 text-white hover:bg-white/10 hover:border-white/20"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-purple-300"
          )}
          onClick={() => vm.setCartOpen(true)}
        >
          <ShoppingBag size={18} className="text-purple-500" />
          <span className="text-[13px] font-black tracking-tight">{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</span>
        </button>
      </div>
    </header>
  );
}
