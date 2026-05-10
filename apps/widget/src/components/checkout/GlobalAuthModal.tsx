import {
  Bot,
  ChartColumn,
  ClipboardList,
  KeyRound,
  LogIn,
  LogOut,
  Smartphone,
  Sparkles,
  UserRound,
  X
} from "lucide-react";
import { useState } from "react";
import type { AccountHubSection, AccountHubState } from "../../hooks/use-account-hub.js";
import type { GlobalAuthController } from "../../hooks/use-global-auth.js";
import { cn } from "../../hooks/checkout-view-model.js";

interface GlobalAuthModalProps {
  auth: GlobalAuthController;
  hub: AccountHubState;
}

const HUB_NAV: Array<{ key: AccountHubSection; label: string; icon: typeof ClipboardList }> = [
  { key: "summary", label: "Resumo", icon: Sparkles },
  { key: "orders", label: "Pedidos", icon: ClipboardList },
  { key: "metrics", label: "Métricas", icon: ChartColumn },
  { key: "account", label: "Conta", icon: UserRound },
  { key: "agent", label: "Agente", icon: Bot }
];

export function GlobalAuthModal({ auth, hub }: GlobalAuthModalProps) {
  const [phone, setPhone] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");

  if (!auth.open) return null;

  const handlePhoneChange = (val: string) => {
    const numbers = val.replace(/\D/g, "").slice(0, 11);
    let masked = numbers;
    if (numbers.length > 2) {
      masked = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    }
    if (numbers.length > 7) {
      masked = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    }
    setPhone(masked);
  };

  const normalizedPhone = phone.replace(/\D/g, "");
  const canSendCode = normalizedPhone.length >= 10;
  const canConfirmCode = codeSent && phoneCode.trim().length === 6;

  if (auth.panel === "hub" && auth.session) {
    const overview = hub.data.overview;
    const merchant = hub.data.merchant;
    const theme = hub.data.merchantTheme;
    const checkoutSettings = hub.data.checkoutSettings;
    const agentContext = hub.data.agentContext;

    return (
      <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6" role="presentation">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={auth.close} />
        <section className="relative flex h-[85vh] max-h-[800px] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[#0c0a16] text-white shadow-2xl aacp-hub-sheet" role="dialog" aria-modal="true">
          <header className="px-8 h-20 border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                <Smartphone size={20} />
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-white/30 leading-none mb-1">Conta Global</span>
                <strong className="block text-sm font-black tracking-tight">{auth.session.email}</strong>
              </div>
            </div>
            <button type="button" className="w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors" onClick={auth.close}>
              <X size={20} />
            </button>
          </header>

          <div className="flex-1 flex overflow-hidden">
            <nav className="w-64 border-r border-white/5 p-6 flex flex-col gap-2">
              {HUB_NAV.map((item) => {
                const Icon = item.icon;
                const active = hub.section === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all",
                      active ? "bg-purple-500/10 text-purple-400 shadow-inner" : "text-white/40 hover:text-white hover:bg-white/5"
                    )}
                    onClick={() => hub.setSection(item.key)}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              <div className="mt-auto pt-6 border-t border-white/5">
                <button type="button" className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-400 hover:bg-red-400/5 transition-all" onClick={auth.logout}>
                  <LogOut size={18} />
                  <span>Sair da conta</span>
                </button>
              </div>
            </nav>

            <main className="flex-1 overflow-y-auto p-8 aacp-scrollbar">
              {hub.loading && (
                <div className="flex items-center justify-center h-40 text-white/30 text-sm font-bold">
                  Carregando...
                </div>
              )}
              {hub.error && !hub.loading && (
                <div className="flex items-center justify-center h-40 text-red-400 text-sm font-bold">
                  {hub.error}
                </div>
              )}
              {!hub.loading && !hub.error && hub.section === "summary" && (
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2 p-8 rounded-[32px] bg-gradient-to-br from-purple-600/20 to-indigo-600/10 border border-purple-500/20 shadow-lg">
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-purple-400">Checkout Inteligente</span>
                    <h3 className="text-3xl font-black text-white tracking-tight mt-2">{merchant?.name ?? "Seu Painel"}</h3>
                    <p className="text-white/40 text-sm mt-4 leading-relaxed">
                      {overview ? `${overview.conversations_started} sessões iniciadas hoje.` : "Carregando estatísticas da API..."}
                    </p>
                  </div>
                  <div className="p-6 rounded-[24px] bg-white/[0.02] border border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Plano Visual</span>
                    <strong className="block text-white text-lg font-black mt-2">{theme?.fontFamily ?? "Padrão"}</strong>
                  </div>
                  <div className="p-6 rounded-[24px] bg-white/[0.02] border border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Sessão</span>
                    <strong className="block text-white text-lg font-black mt-2">{auth.session.provider === "password" ? "Senha" : "SMS/Global"}</strong>
                  </div>
                </div>
              )}

              {!hub.loading && !hub.error && hub.section === "orders" && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-black tracking-tight">Sessões Recentes</h3>
                  <div className="flex flex-col gap-4">
                    {overview?.recent_sessions?.map((sess) => (
                      <div key={sess.sessionId} className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 flex justify-between items-center">
                        <div className="flex flex-col">
                          <strong className="text-sm font-bold tracking-tight text-white">{sess.sessionId}</strong>
                          <span className="text-xs text-white/40 mt-1">Total: R$ {sess.cart.total.toFixed(2)}</span>
                        </div>
                        <span className="text-xs text-purple-400 font-bold">{sess.customer?.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hub.loading && !hub.error && hub.section === "metrics" && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-black tracking-tight">Estatísticas Operacionais</h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Receita IA</span>
                      <strong className="block text-emerald-400 text-2xl font-black mt-2">R$ {overview?.incremental_revenue?.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              )}

              {!hub.loading && !hub.error && hub.section === "agent" && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-black tracking-tight">Informações do Agente</h3>
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block mb-1">Nome</span>
                      <strong className="text-white font-bold">{agentContext?.agent?.agentName}</strong>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block mb-1">Persona</span>
                      <p className="text-white/80 text-sm leading-relaxed">{agentContext?.agent?.persona}</p>
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/20 block mb-1">Modo de Operação</span>
                      <strong className="text-purple-400 font-bold uppercase text-xs tracking-wider">{agentContext?.checkout_settings?.agentMode}</strong>
                    </div>
                  </div>
                </div>
              )}

              {!hub.loading && !hub.error && hub.section === "account" && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-black tracking-tight">Sua Conta</h3>
                  <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                    <p className="text-sm text-white/60">Detalhes da conta de administrador do merchant.</p>
                  </div>
                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={auth.close} />
      <section className="relative w-full max-w-[440px] rounded-[32px] bg-[#0c0a16] p-10 text-white shadow-[0_24px_80px_rgba(0,0,0,0.8),0_0_40px_rgba(168,85,247,0.15)] border border-white/10 overflow-hidden" role="dialog" aria-modal="true">
        <button type="button" className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white transition-colors" onClick={auth.close}>
          <X size={20} />
        </button>

        <div className="relative group w-16 h-16 mb-8 shrink-0">
          <div className="absolute -inset-1 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl blur opacity-40"></div>
          <div className="relative w-full h-full rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-2xl">
            <LogIn size={28} strokeWidth={2.5} />
          </div>
        </div>

        <h2 className="text-3xl font-black text-white tracking-tight mb-2">Entrar com celular</h2>
        <p className="text-white/40 text-sm font-medium mb-8">Bem-vindo de volta! Entre para acelerar o checkout e acessar seus pedidos</p>

        <button
          type="button"
          className="w-full h-14 rounded-2xl bg-white text-slate-900 flex items-center justify-center gap-3 text-sm font-black tracking-tight hover:bg-slate-100 transition-all active:scale-[0.98] mb-8"
          disabled
        >
          <img src="https://www.google.com/favicon.ico" alt="" className="w-5 h-5 grayscale opacity-50" />
          Entrar com Google em breve
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="h-px bg-white/10 flex-1" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">ou com celular</span>
          <div className="h-px bg-white/10 flex-1" />
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => e.preventDefault()}
        >
          {!codeSent ? (
            <div className="relative group">
              <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-purple-400 transition-colors" size={20} />
              <input
                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-all font-medium"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                type="tel"
                placeholder="(11) 99999-9999"
              />
            </div>
          ) : (
            <div className="relative group">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-purple-400 transition-colors" size={20} />
              <input
                className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-all font-medium tracking-[0.5em]"
                value={phoneCode}
                onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                type="text"
                placeholder="000000"
                maxLength={6}
              />
            </div>
          )}

          {codeSent && (
            <p className="text-emerald-400 text-xs text-center font-bold">
              Codigo enviado para {normalizedPhone}
            </p>
          )}

          {auth.error ? <p className="text-red-400 text-[11px] font-bold text-center px-2">{auth.error}</p> : null}

          <button
            type="button"
            className="w-full h-14 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white text-sm font-black uppercase tracking-widest shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
            disabled={auth.loading || (!codeSent && !canSendCode) || (codeSent && !canConfirmCode)}
            onClick={() => {
              if (!codeSent) {
                // Here we would call the actual API
                setCodeSent(true);
              } else {
                // Here we would call the verify API
              }
            }}
          >
            {auth.loading ? "Processando..." : codeSent ? "Confirmar codigo" : "Enviar codigo por SMS"}
          </button>
        </form>
      </section>
    </div>
  );
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="p-6 rounded-[24px] bg-white/[0.02] border border-white/5">
      <span className="text-[10px] font-black uppercase tracking-widest text-white/20">{label}</span>
      <strong className="block text-white text-lg font-black mt-1">{value}</strong>
    </article>
  );
}
