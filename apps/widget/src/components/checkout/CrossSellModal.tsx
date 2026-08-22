import { useState, useEffect, useRef } from "react";
import { Package, Plus, Check, X, ArrowRight } from "lucide-react";
import type { SuggestedProduct } from "@zyon/shared-types";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

interface CrossSellModalProps {
  products: SuggestedProduct[];
  currency?: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
  onDismiss: () => void;
  onProceedToPayment: () => void;
}

export function CrossSellModal({ products, currency = "BRL", onAdd, onDismiss, onProceedToPayment }: CrossSellModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Trap focus within the modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  if (!products.length) return null;

  return (
    <div
      className="aacp-cross-sell-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Complementos sugeridos"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      <div className="aacp-cross-sell-modal" ref={dialogRef}>
        <div className="aacp-cross-sell-modal-header">
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
            <X size={16} />
          </button>
        </div>

        <div className="aacp-cross-sell-modal-body">
          {products.map((product) => (
            <CrossSellModalCard
              key={product.sku}
              product={product}
              currency={currency}
              onAdd={onAdd}
            />
          ))}
        </div>

        <div className="aacp-cross-sell-modal-footer">
          <button
            type="button"
            className="aacp-cross-sell-skip"
            onClick={onProceedToPayment}
          >
            Continuar sem adicionar
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CrossSellModalCard({
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
    <article className="aacp-cross-sell-modal-card">
      <div className="aacp-cross-sell-modal-thumb">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="aacp-cross-sell-modal-thumb-image"
          />
        ) : (
          <Package size={24} className="aacp-cross-sell-modal-thumb-fallback" />
        )}
      </div>

      <div className="aacp-cross-sell-modal-content">
        <div className="aacp-cross-sell-modal-name">{product.name}</div>
        {product.variant ? (
          <div className="aacp-cross-sell-modal-variant">{product.variant}</div>
        ) : null}
        {product.description ? (
          <div className="aacp-cross-sell-modal-desc">{product.description}</div>
        ) : null}
        <div className="aacp-cross-sell-modal-price">
          {formatCurrency(product.unit_price, currency)}
        </div>
      </div>

      <button
        type="button"
        disabled={loading || added}
        onClick={() => void handleAdd()}
        className="aacp-cta aacp-cross-sell-modal-add"
        aria-describedby={error ? `${product.sku}-modal-cross-sell-error` : undefined}
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
      {error ? (
        <p id={`${product.sku}-modal-cross-sell-error`} className="aacp-cross-sell-modal-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
