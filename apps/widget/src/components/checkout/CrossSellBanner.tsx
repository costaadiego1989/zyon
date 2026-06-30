import { useState } from "react";
import { ArrowRight, Package, Plus, Check, X } from "lucide-react";
import type { SuggestedProduct } from "@zyon/shared-types";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

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
    <section className="aacp-cross-sell mt-3" aria-label="Complementos sugeridos">
      <div className="aacp-cross-sell-head">
        <div>
          <span className="aacp-cross-sell-kicker">Antes de pagar</span>
          <strong className="aacp-cross-sell-title">Você também pode gostar</strong>
        </div>
        <button
          type="button"
          aria-label="Fechar sugestões"
          onClick={onDismiss}
          className="aacp-cross-sell-dismiss"
        >
          <X size={14} />
        </button>
      </div>

      <div className="aacp-cross-sell-list">
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
        className="aacp-cross-sell-skip"
        onClick={onProceedToPayment}
      >
        Continuar sem adicionar
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
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
    <article className="aacp-cross-sell-card">
      <div className="aacp-cross-sell-thumb">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="aacp-cross-sell-thumb-image"
          />
        ) : (
          <Package size={20} className="aacp-cross-sell-thumb-fallback" />
        )}
      </div>

      <div className="aacp-cross-sell-body">
        <div className="aacp-cross-sell-name">{product.name}</div>
        {product.variant ? (
          <div className="aacp-cross-sell-variant">{product.variant}</div>
        ) : null}
        <div className="aacp-cross-sell-price">
          {formatCurrency(product.unit_price, currency)}
        </div>
      </div>

      <button
        type="button"
        disabled={loading || added}
        onClick={() => void handleAdd()}
        className="aacp-cta aacp-cross-sell-add"
        aria-label={added ? `${product.name} adicionado` : `Adicionar ${product.name}`}
      >
        {added ? (
          <>
            <Check size={14} />
            Adicionado
          </>
        ) : (
          <>
            <Plus size={14} />
            Adicionar
          </>
        )}
      </button>
    </article>
  );
}
