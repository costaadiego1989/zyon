import { useState } from "react";
import { Package, Plus, Check, X } from "lucide-react";
import type { SuggestedProduct } from "@zyon/shared-types";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

interface CrossSellInlineProps {
  products: SuggestedProduct[];
  currency?: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
  onDismiss: () => void;
  onProceedToPayment: () => void;
}

export function CrossSellInline({ products, currency = "BRL", onAdd, onDismiss, onProceedToPayment }: CrossSellInlineProps) {
  if (!products.length) return null;

  return (
    <section className="aacp-cross-sell aacp-cross-sell--inline mt-3" aria-label="Complementos sugeridos">
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

      <div className="aacp-cross-sell-inline-container">
        {products.map((product) => (
          <CrossSellInlineCard
            key={product.sku}
            product={product}
            currency={currency}
            onAdd={onAdd}
          />
        ))}
      </div>

      <button
        type="button"
        className="aacp-cross-sell-skip aacp-cross-sell-skip--inline"
        onClick={onProceedToPayment}
      >
        Continuar sem adicionar
      </button>
    </section>
  );
}

function CrossSellInlineCard({
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
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    setLoading(true);
    setError(null);
    try {
      const success = await onAdd(product);
      if (success) setAdded(true);
      else setError("Não foi possível adicionar agora.");
    } catch {
      setError("Não foi possível adicionar agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="aacp-cross-sell-inline-card">
      <div className="aacp-cross-sell-inline-thumb">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="aacp-cross-sell-inline-thumb-image"
          />
        ) : (
          <Package size={16} className="aacp-cross-sell-inline-thumb-fallback" />
        )}
      </div>

      <div className="aacp-cross-sell-inline-body">
        <div className="aacp-cross-sell-inline-name">{product.name}</div>
        {product.variant ? (
          <div className="aacp-cross-sell-inline-variant">{product.variant}</div>
        ) : null}
      </div>

      <div className="aacp-cross-sell-inline-price">
        {formatCurrency(product.unit_price, currency)}
      </div>

      <button
        type="button"
        disabled={loading || added}
        onClick={() => void handleAdd()}
        className="aacp-cta aacp-cross-sell-inline-add"
        aria-describedby={error ? `${product.sku}-inline-cross-sell-error` : undefined}
        aria-label={added ? `${product.name} adicionado` : `Adicionar ${product.name}`}
      >
        {added ? (
          <Check size={12} />
        ) : (
          <Plus size={12} />
        )}
      </button>
      {error ? (
        <p id={`${product.sku}-inline-cross-sell-error`} className="aacp-cross-sell-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
