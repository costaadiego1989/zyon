import { useState } from "react";
import { ArrowRight, Package, Plus, Check, X } from "lucide-react";
import type { SuggestedProduct } from "@aacp/shared-types";
import { formatCurrency } from "../../hooks/checkout-view-model.js";

interface CrossSellBannerProps {
  products: SuggestedProduct[];
  currency?: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
  onDismiss: () => void;
  onProceedToPayment: () => void;
}

export function CrossSellBanner({ products, currency = "BRL", onAdd, onDismiss, onProceedToPayment }: CrossSellBannerProps) {
  if (!products.length) return null;

  return (
    <div className="aacp-cross-sell mt-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">
          Você também pode gostar
        </span>
        <button
          type="button"
          aria-label="Fechar sugestões"
          onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--aacp-surface-2)] text-[var(--aacp-muted)] transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {products.map((product) => (
          <CrossSellCard
            key={product.sku}
            product={product}
            currency={currency}
            onAdd={onAdd}
          />
        ))}
      </div>

      <button
        type="button"
        className="aacp-cross-sell-proceed"
        onClick={onProceedToPayment}
      >
        Finalizar pagamento agora
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function CrossSellCard({
  product,
  currency,
  onAdd
}: {
  product: SuggestedProduct;
  currency: string;
  onAdd: (p: SuggestedProduct) => Promise<boolean>;
}) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  async function handleAdd() {
    setLoading(true);
    const success = await onAdd(product);
    setLoading(false);
    if (success) setAdded(true);
  }

  return (
    <article className="aacp-cross-sell-card flex items-center gap-3 rounded-xl border border-[var(--aacp-line)] bg-[var(--aacp-surface-2)] p-3">
      <div className="aacp-cross-sell-thumb w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-[var(--aacp-surface-3)] shrink-0">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Package size={20} className="opacity-30" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[var(--aacp-fg)] truncate">{product.name}</div>
        {product.variant && (
          <div className="text-[11px] text-[var(--aacp-muted)]">{product.variant}</div>
        )}
        <div className="text-sm font-bold text-[var(--aacp-accent)] mt-0.5">
          {formatCurrency(product.unit_price, currency)}
        </div>
      </div>

      <button
        type="button"
        disabled={loading || added}
        onClick={() => void handleAdd()}
        className="aacp-cross-sell-add"
      >
        {added ? (
          <>
            <Check size={12} />
            Adicionado!
          </>
        ) : (
          <>
            <Plus size={12} />
            Adicionar {product.name}
          </>
        )}
      </button>
    </article>
  );
}
