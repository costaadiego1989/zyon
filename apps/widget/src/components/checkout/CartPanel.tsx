import { Check, CheckCircle2, Package, ShoppingBag, Store, Trash2, X, ShieldCheck, LockKeyhole, BadgeCheck, RefreshCw, Tag } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, formatCurrency, stageLabel } from "../../hooks/checkout-view-model.js";

export function CartPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  const experience = vm.activeExperience;

  return (
    <aside
      id="aacp-cart-panel"
      className={cn("aacp-cart", vm.cartOpen ? "open" : "")}
      aria-label="Resumo do pedido"
    >
      <div className="aacp-cart-header">
        <div className="aacp-cart-logo">
          {vm.theme.logoUrl ? (
            <img src={vm.theme.logoUrl} alt={experience.brand.name} />
          ) : (
            <Store size={20} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="aacp-cart-store">{experience.brand.name}</div>
          <span className="aacp-cart-headline">Pedido #{vm.session?.session_id?.slice(-6) ?? "3EE8A6"}</span>
        </div>

        {(import.meta as any).env?.DEV && (
          <button
            type="button"
            className="text-xs font-bold px-2 py-1 bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
            onClick={() => {
              window.localStorage.removeItem("aacp_session_id");
              window.location.reload();
            }}
            title="Resetar Sessão"
          >
            Reset
          </button>
        )}

        <button className="aacp-cart-close lg:hidden" onClick={() => vm.setCartOpen(false)} aria-label="Fechar" type="button">
          <X size={18} />
        </button>
      </div>

      <div className="aacp-intel">
        <div>
          <span>Etapa</span>
          <strong>{stageLabel(vm.checkoutStage)}</strong>
        </div>
        <div>
          <span>Frete</span>
          <strong>{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</strong>
        </div>
        <div>
          <span>Proteção</span>
          <strong>{vm.offer?.approved ? "Oferta" : "Ativa"}</strong>
        </div>
      </div>

      <div className="aacp-guardrails-cart" role="group" aria-label="Garantias e segurança da sessão">
        <span className="aacp-badge"><ShieldCheck size={12} />Margem protegida</span>
        <span className="aacp-badge"><ShieldCheck size={12} />Sem dados sensíveis</span>
      </div>

      <div className="aacp-trust-row">
        <span className="aacp-trust-pill"><ShieldCheck size={12} />Compra segura</span>
        <span className="aacp-trust-pill"><LockKeyhole size={12} />SSL 256-bit</span>
      </div>

      <div>
        <div className="aacp-section-title">Seu pedido agora · {vm.visibleItems.length}</div>
        <div className="aacp-items">
          {vm.visibleItems.length > 0 ? (
            vm.visibleItems.map((item) => (
              <div key={item.sku} className="aacp-item">
                <div className="aacp-item-thumb">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" />
                  ) : (
                    <Package size={22} />
                  )}
                </div>
                <div className="aacp-item-info">
                  <div className="aacp-item-name">{item.name}</div>
                  <div className="aacp-item-meta">{item.variant ? `${item.variant} · ` : ""}Qtd × {item.quantity}</div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] font-bold uppercase mt-1 text-red-400 hover:text-red-300 transition-colors"
                    onClick={() => vm.handleRemoveCartItem(item.sku)}
                    disabled={vm.busy}
                  >
                    <Trash2 size={10} /> Remover
                  </button>
                </div>
                <div className="aacp-item-price">{formatCurrency(item.line_total, vm.visibleTotals.currency)}</div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center flex flex-col items-center justify-center gap-4 text-[var(--aacp-muted)]">
              <ShoppingBag size={32} className="opacity-20" />
              <div className="text-sm font-semibold">Seu carrinho está vazio</div>
              {vm.config.emptyCartRedirectUrl && (
                <a
                  href={vm.config.emptyCartRedirectUrl}
                  className="mt-2 text-xs font-bold text-[var(--aacp-accent)] border border-[var(--aacp-accent)] rounded-full px-4 py-2 hover:bg-[var(--aacp-accent)] hover:text-white transition-colors"
                >
                  Voltar para Loja
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <dl className="aacp-totals">
        <dt>Subtotal</dt>
        <dd>{formatCurrency(vm.visibleTotals.subtotal, vm.visibleTotals.currency)}</dd>
        {vm.visibleTotals.shipping > 0 && (
          <>
            <dt>Frete</dt>
            <dd>{formatCurrency(vm.visibleTotals.shipping, vm.visibleTotals.currency)}</dd>
          </>
        )}
        <dt className="total-row">Total</dt>
        <dd className="total-row value">{formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency)}</dd>
      </dl>

      {vm.showCouponBox && (
        <form
          className="aacp-coupon"
          onSubmit={(e) => {
            e.preventDefault();
            void vm.submitCoupon();
          }}
        >
          <Tag size={16} />
          <input
            type="text"
            value={vm.coupon}
            onChange={(e) => vm.setCoupon(e.target.value)}
            placeholder="Código do cupom"
            aria-label="Cupom"
          />
          <button type="submit" disabled={!vm.coupon.trim() || vm.busy} style={{ background: 'var(--aacp-grad-primary)', color: '#fff', border: 'none', borderRadius: '999px', padding: '6px 14px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Aplicar</button>
        </form>
      )}
    </aside>
  );
}
