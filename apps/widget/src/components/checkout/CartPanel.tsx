import { CheckCircle2, Package, ShoppingBag, Store, Trash2, X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency, stageLabel } from "../../hooks/checkout-view-model.js";

export function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const experience = vm.activeExperience;
  const isDark = vm.colorMode === "dark";

  return (
    <aside
      id="aacp-cart-panel"
      className={cn(
        "fixed lg:relative top-0 right-0 h-full w-[min(420px,100%)] z-40 transform transition-transform duration-500 lg:translate-x-0 flex flex-col shadow-2xl",
        isDark ? "bg-[#0c0a16] border-l border-white/5" : "bg-slate-50 border-l border-slate-200",
        vm.cartOpen ? "translate-x-0" : "translate-x-full"
      )}
      aria-label="Resumo do pedido"
    >
      <div className={cn("px-6 border-b flex items-center gap-4 h-[100px] shrink-0", isDark ? "border-white/5" : "border-slate-200")}>
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center shadow-inner shrink-0",
          isDark ? "bg-purple-600/10 text-purple-400" : "bg-purple-100 text-purple-600"
        )} aria-hidden="true">
          {vm.theme.logoUrl ? (
            <img src={vm.theme.logoUrl} alt={experience.brand.name} className="w-full h-full rounded-xl object-contain bg-white p-1 aacp-cart-logo" />
          ) : (
            <Store size={24} />
          )}
        </div>
        <div className="flex-1 min-w-0 aacp-cart-brand">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn("text-[9px] font-black uppercase tracking-[0.2em]", isDark ? "text-purple-400" : "text-purple-600")}>Carrinho</span>
            <span className={isDark ? "text-white/20" : "text-slate-300"}>•</span>
            <span className={cn("text-[9px] font-bold uppercase tracking-widest", isDark ? "text-white/30" : "text-slate-400")}>#{vm.session?.session_id?.slice(-6) ?? "3EE8A6"}</span>
          </div>
          <strong className={cn("block text-lg font-black tracking-tight leading-tight truncate", isDark ? "text-white" : "text-slate-800")}>{experience.brand.name}</strong>
        </div>
        {(import.meta as any).env?.DEV && (
          <button
            type="button"
            className={cn(
              "h-10 px-3 flex items-center justify-center rounded-xl border transition-all text-xs font-bold shrink-0",
              isDark
                ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            )}
            onClick={() => {
              window.localStorage.removeItem("aacp_session_id");
              window.location.reload();
            }}
            title="Resetar Sessão (Apenas Dev)"
          >
            Reset
          </button>
        )}
        <button
          className={cn(
            "lg:hidden w-10 h-10 rounded-full border flex items-center justify-center transition-colors",
            isDark ? "border-white/10 bg-white/5 text-white hover:bg-white/10" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          )}
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo"
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      <div className={cn("grid grid-cols-3 border-b h-[60px]", isDark ? "border-white/5 bg-white/[0.01]" : "border-slate-200 bg-white")}>
        <div className={cn("px-4 border-r flex flex-col justify-center gap-0.5", isDark ? "border-white/5" : "border-slate-200")}>
          <span className={cn("text-[9px] uppercase font-bold tracking-widest", isDark ? "text-white/30" : "text-slate-400")}>Etapa</span>
          <strong className={cn("text-xs font-black leading-tight", isDark ? "text-white/90" : "text-slate-700")}>{stageLabel(vm.checkoutStage)}</strong>
        </div>
        <div className={cn("px-4 border-r flex flex-col justify-center gap-0.5", isDark ? "border-white/5" : "border-slate-200")}>
          <span className={cn("text-[9px] uppercase font-bold tracking-widest", isDark ? "text-white/30" : "text-slate-400")}>Frete</span>
          <strong className={cn("text-xs font-black leading-tight", isDark ? "text-white/90" : "text-slate-700")}>{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</strong>
        </div>
        <div className="px-4 flex flex-col justify-center gap-0.5">
          <span className={cn("text-[9px] uppercase font-bold tracking-widest", isDark ? "text-white/30" : "text-slate-400")}>Proteção</span>
          <strong className="text-xs text-emerald-500 font-black leading-tight">{vm.offer?.approved ? "Oferta" : "Ativa"}</strong>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 aacp-scrollbar space-y-8">
        <div className="relative">
          <h2 className={cn("text-xl font-black tracking-tight mb-2 aacp-cart-title", isDark ? "text-white" : "text-slate-800")}>Seu pedido agora</h2>
          <p className={cn("text-xs flex items-center gap-2", isDark ? "text-white/40" : "text-slate-500")}>
            <ShoppingBag size={14} className={isDark ? "text-purple-400/60" : "text-purple-500/70"} />
            {vm.cartItemCount} {vm.cartItemCount === 1 ? "item" : "itens"} no carrinho
          </p>
        </div>

        <div>
          <div className={cn("text-[10px] font-black uppercase tracking-[0.2em] mb-5 flex items-center gap-3", isDark ? "text-white/10" : "text-slate-300")}>
            Itens
            <span className={cn("h-px flex-1", isDark ? "bg-white/5" : "bg-slate-200")} />
          </div>
          <ul className="space-y-4">
            {vm.visibleItems.length > 0 ? (
              vm.visibleItems.map((item) => (
                <li key={item.sku} className={cn(
                  "p-4 rounded-2xl border flex gap-4 items-center group relative",
                  isDark ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-white"
                )}>
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform",
                    isDark ? "bg-purple-500/10 text-purple-400" : "bg-purple-100 text-purple-600"
                  )}>
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="w-full h-full object-cover rounded-xl" />
                    ) : (
                      <Package size={20} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm font-bold leading-tight truncate", isDark ? "text-white" : "text-slate-800")}>{item.name}</div>
                    <div className={cn("text-[10px] mt-1 uppercase tracking-wider font-black", isDark ? "text-white/30" : "text-slate-400")}>
                      {item.variant ? `${item.variant} · ` : ""}Qtd x {item.quantity}
                    </div>
                    <button
                      type="button"
                      className={cn("mt-2.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.15em] hover:text-red-500 transition-colors", isDark ? "text-white/30" : "text-slate-400")}
                      onClick={() => vm.handleRemoveCartItem(item.sku)}
                      disabled={vm.busy}
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash2 size={12} />
                      Remover
                    </button>
                  </div>
                  <div className={cn("text-sm font-black shrink-0 self-start mt-1", isDark ? "text-white" : "text-slate-800")}>
                    {formatCurrency(item.line_total, vm.visibleTotals.currency)}
                  </div>
                </li>
              ))
            ) : (
              <li className="py-12 text-center flex flex-col items-center justify-center gap-6 aacp-cart-empty">
                <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", isDark ? "bg-white/5 text-white/10" : "bg-slate-100 text-slate-300")}>
                  <ShoppingBag size={32} />
                </div>
                <div className="space-y-2">
                  <strong className={cn("block text-base font-bold", isDark ? "text-white/90" : "text-slate-800")}>Seu carrinho está vazio</strong>
                  <p className={cn("text-xs px-4", isDark ? "text-white/40" : "text-slate-500")}>Adicione produtos para continuar finalizando sua compra com o assistente.</p>
                </div>
                {vm.config.emptyCartRedirectUrl && (
                  <a
                    href={vm.config.emptyCartRedirectUrl}
                    id="aacp-empty-cart-redirect-btn"
                    className={cn(
                      "inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all duration-300 shadow-lg shadow-purple-500/10 hover:shadow-purple-500/20 active:scale-95",
                      isDark 
                        ? "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white" 
                        : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                    )}
                  >
                    Voltar para a Loja
                  </a>
                )}
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className={cn("p-6 border-t", isDark ? "border-white/5 bg-[#07060d]/50 backdrop-blur-xl" : "border-slate-200 bg-slate-50")}>
        {vm.showCouponBox && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void vm.submitCoupon();
            }}
            className="mb-6 flex gap-2"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={vm.coupon}
                onChange={(e) => vm.setCoupon(e.target.value)}
                placeholder="Código do cupom"
                aria-label="Cupom de desconto"
                className={cn(
                  "w-full h-11 px-4 rounded-xl text-xs font-semibold focus:outline-none focus:border-purple-500/50 transition-colors",
                  isDark
                    ? "bg-white/5 border border-white/10 text-white placeholder-white/20"
                    : "bg-slate-100 border border-slate-200 text-slate-800 placeholder-slate-400"
                )}
              />
            </div>
            <button
              type="submit"
              className={cn(
                "px-5 h-11 rounded-xl text-xs font-bold transition-all active:scale-95 shrink-0",
                isDark
                  ? "bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20"
                  : "bg-purple-600 hover:bg-purple-700 text-white shadow-md"
              )}
            >
              Aplicar
            </button>
          </form>
        )}

        <dl className={cn("p-5 rounded-2xl border space-y-4 mb-6", isDark ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-white")}>
          <div className="flex justify-between text-sm">
            <dt className={cn("font-bold uppercase tracking-widest text-[10px]", isDark ? "text-white/40" : "text-slate-400")}>Subtotal</dt>
            <dd className={cn("font-bold", isDark ? "text-white" : "text-slate-800")}>{formatCurrency(vm.visibleTotals.subtotal, vm.visibleTotals.currency)}</dd>
          </div>
          <div className="flex justify-between text-sm">
            <dt className={cn("font-bold uppercase tracking-widest text-[10px]", isDark ? "text-white/40" : "text-slate-400")}>Frete</dt>
            <dd className={cn("font-bold", isDark ? "text-white" : "text-slate-800")}>{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</dd>
          </div>
          <div className={cn("h-px", isDark ? "bg-white/10" : "bg-slate-100")} />
          <div className="flex justify-between items-baseline aacp-cart-total">
            <dt className={cn("text-base font-black uppercase tracking-[0.1em]", isDark ? "text-white" : "text-slate-800")}>Total</dt>
            <dd className="text-2xl font-black bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent tracking-tight">
              {formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}
            </dd>
          </div>
        </dl>

        <ul className="space-y-2">
          <li className={cn("flex gap-2 text-[10px] leading-tight", isDark ? "text-white/30" : "text-slate-500")}>
            <CheckCircle2 className="shrink-0 text-emerald-500/50" size={12} />
            Compra segura e identidade validada no servidor
          </li>
          <li className={cn("flex gap-2 text-[10px] leading-tight", isDark ? "text-white/30" : "text-slate-500")}>
            <CheckCircle2 className="shrink-0 text-emerald-500/50" size={12} />
            O assistente nunca solicita senha ou CVV no chat
          </li>
        </ul>
      </div>
    </aside>
  );
}
