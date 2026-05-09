import { CheckCircle2, LockKeyhole, Package, ShoppingBag, Store, Tag, Trash2, X } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency, stageLabel } from "../../hooks/checkout-view-model.js";

export function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const experience = vm.activeExperience;
  return (
    <aside
      id="aacp-cart-panel"
      className={cn(
        "fixed lg:relative top-0 right-0 h-full w-[min(420px,100%)] bg-[#0f0d1a] border-l border-white/5 z-40 transform transition-transform duration-500 lg:translate-x-0 flex flex-col shadow-2xl",
        vm.cartOpen ? "translate-x-0" : "translate-x-full"
      )}
      aria-label="Resumo do pedido"
    >
      <div className="p-6 border-b border-white/5 flex items-center gap-4">
        {vm.theme.logoUrl ? (
          <img src={vm.theme.logoUrl} alt={experience.brand.name} className="w-10 h-10 rounded-xl object-contain bg-white shadow-inner p-1" />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-purple-600/10 text-purple-400 flex items-center justify-center shadow-inner" aria-hidden="true"><Store size={20} /></div>
        )}
        <div className="flex-1 min-w-0">
          <strong className="block text-white text-base font-black tracking-tight leading-tight">{experience.brand.name}</strong>
          <span className="block text-[10px] text-white/40 uppercase font-black tracking-[0.1em] mt-0.5">Pedido #{vm.session?.session_id?.slice(-6) ?? experience.brand.merchant_id}</span>
        </div>
        <button
          className="lg:hidden w-10 h-10 rounded-full border border-white/10 bg-white/5 text-white flex items-center justify-center hover:bg-white/10 transition-colors"
          onClick={() => vm.setCartOpen(false)}
          aria-label="Fechar resumo"
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-3 border-b border-white/5 bg-white/[0.02]">
        <div className="p-4 border-r border-white/5 flex flex-col gap-1">
          <span className="text-[9px] uppercase font-black tracking-widest text-white/30">Etapa</span>
          <strong className="text-xs text-white/90 font-bold">{stageLabel(vm.checkoutStage)}</strong>
        </div>
        <div className="p-4 border-r border-white/5 flex flex-col gap-1">
          <span className="text-[9px] uppercase font-black tracking-widest text-white/30">Frete</span>
          <strong className="text-xs text-white/90 font-bold">{vm.visibleTotals.shipping > 0 ? formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency) : "A validar"}</strong>
        </div>
        <div className="p-4 flex flex-col gap-1">
          <span className="text-[9px] uppercase font-black tracking-widest text-white/30">Proteção</span>
          <strong className="text-xs text-emerald-400 font-bold">{vm.offer?.approved ? "Oferta" : "Ativa"}</strong>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 aacp-scrollbar space-y-8">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-400/60 mb-1">Carrinho</div>
          <h2 className="text-xl font-black text-white tracking-tight mb-2">Seu pedido agora</h2>
          <p className="text-sm text-white/40">
            {vm.cartItemCount} item{vm.cartItemCount === 1 ? "" : "s"} no carrinho · {experience.brand.name}
          </p>
        </div>

        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-4 flex items-center gap-2">
            <span className="h-px bg-white/10 flex-1" />
            Itens
            <span className="h-px bg-white/10 flex-1" />
          </div>
          <ul className="space-y-6">
            {vm.visibleItems.length > 0 ? (
              vm.visibleItems.map((item) => (
                <li className="flex gap-4 items-start" key={item.sku}>
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-2xl object-cover border border-white/5 bg-white/5 shadow-md" />
                  ) : (
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/20 shadow-md" aria-hidden="true"><Package size={22} /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white leading-snug mb-0.5 truncate">{item.name}</div>
                    <div className="text-[11px] text-white/40">
                      {item.variant ? `${item.variant} · ` : ""}Qtd x {item.quantity}
                    </div>
                    <button
                      type="button"
                      className="mt-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-red-400 transition-colors"
                      aria-label={`Remover ${item.name}`}
                      onClick={() => vm.handleRemoveCartItem(item.sku)}
                      disabled={vm.busy}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      Remover
                    </button>
                  </div>
                  <div className="text-sm font-black text-white">{formatCurrency(item.line_total, vm.visibleTotals.currency)}</div>
                </li>
              ))
            ) : (
              <li className="py-12 text-center flex flex-col gap-3" role="status">
                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/20 mx-auto">
                  <ShoppingBag size={24} />
                </div>
                <strong className="text-sm text-white/60">Carrinho vazio</strong>
                <span className="text-xs text-white/30">Você pode voltar ao chat e continuar quando quiser.</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Footer Area */}
      <div className="p-6 border-t border-white/5 bg-[#07060d]/50 backdrop-blur-xl">
        <dl className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <dt className="text-white/40">Subtotal</dt>
            <dd className="text-white/80 font-medium">{formatCurrency(vm.visibleTotals.subtotal, vm.visibleTotals.currency)}</dd>
          </div>
          {vm.visibleTotals.shipping > 0 ? (
            <div className="flex justify-between text-sm">
              <dt className="text-white/40">Frete</dt>
              <dd className="text-white/80 font-medium">{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</dd>
            </div>
          ) : null}
          {vm.visibleTotals.discount > 0 ? (
            <div className="flex justify-between text-sm">
              <dt className="text-purple-400 font-bold">Desconto</dt>
              <dd className="text-purple-400 font-black">-{formatCurrency(vm.visibleTotals.discount, vm.visibleTotals.currency)}</dd>
            </div>
          ) : null}
          <div className="pt-3 border-t border-white/10 flex justify-between items-baseline">
            <dt className="text-base font-black text-white uppercase tracking-wider">Total</dt>
            <dd className="text-2xl font-black text-white tracking-tight">{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</dd>
          </div>
        </dl>

        {vm.showCouponBox ? (
          <form
            className="mb-4 relative"
            onSubmit={(event) => {
              event.preventDefault();
              void vm.submitCoupon();
            }}
          >
            <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" size={16} aria-hidden="true" />
            <input
              className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-11 pr-24 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 transition-all"
              value={vm.coupon}
              onChange={(event) => vm.setCoupon(event.target.value)}
              placeholder="Cupom de desconto"
              aria-label="Cupom de desconto"
              disabled={vm.busy || Boolean(vm.networkError)}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-colors disabled:opacity-30"
              type="submit"
              disabled={vm.busy || !vm.coupon.trim()}
            >
              Aplicar
            </button>
          </form>
        ) : null}

        <div className="space-y-3">
          {!vm.showOfferBanner && vm.offer?.approved ? (
            <button
              type="button"
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-black uppercase tracking-[0.15em] shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
              disabled={vm.busy}
              onClick={() => void vm.applyOffer()}
            >
              Aplicar oferta autorizada
            </button>
          ) : null}

          {vm.config.mode === "embed" && vm.session ? (
            <button
              type="button"
              className="w-full py-4 rounded-2xl border border-white/10 bg-white/5 text-white text-sm font-bold hover:bg-white/10 transition-all disabled:opacity-50"
              disabled={vm.busy}
              onClick={() => void vm.createEmbedPaymentIntentDemo()}
            >
              Demo: gerar cobranca (PIX)
            </button>
          ) : null}
        </div>

        <ul className="mt-6 space-y-2">
          <li className="flex gap-2 text-[10px] text-white/30 leading-tight">
            <CheckCircle2 className="shrink-0 text-emerald-500/50" size={12} />
            Compra segura e identidade validada no servidor
          </li>
          <li className="flex gap-2 text-[10px] text-white/30 leading-tight">
            <CheckCircle2 className="shrink-0 text-emerald-500/50" size={12} />
            O assistente nunca solicita senha ou CVV no chat
          </li>
        </ul>
      </div>
    </aside>
  );
}
