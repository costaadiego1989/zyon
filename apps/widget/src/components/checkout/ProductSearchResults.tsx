import { useState } from "react";
import { Check, Package, Plus } from "lucide-react";
import type { SuggestedProduct } from "@zyon/shared-types";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

export function ProductSearchResults({
  products,
  currency = "BRL",
  onAdd
}: {
  products: SuggestedProduct[];
  currency?: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
}) {
  if (!products.length) return null;

  return (
    <div className="aacp-catalog-results" role="list" aria-label="Produtos encontrados na loja">
      <div className="aacp-catalog-results-head">Resultados da loja</div>
      <div className="aacp-catalog-results-list">
        {products.map((product) => (
          <CatalogResultCard key={product.sku} product={product} currency={currency} onAdd={onAdd} />
        ))}
      </div>
    </div>
  );
}

function CatalogResultCard({
  product,
  currency,
  onAdd
}: {
  product: SuggestedProduct;
  currency: string;
  onAdd: (product: SuggestedProduct) => Promise<boolean>;
}) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  async function handleAdd() {
    setLoading(true);
    const ok = await onAdd(product);
    setLoading(false);
    if (ok) setAdded(true);
  }

  return (
    <article className="aacp-catalog-result-card" role="listitem">
      <div className="aacp-catalog-result-thumb">
        {product.image_url ? <img src={product.image_url} alt="" /> : <Package size={20} />}
      </div>
      <div className="aacp-catalog-result-body">
        <strong className="aacp-catalog-result-name">{product.name}</strong>
        {product.description ? <p className="aacp-catalog-result-desc">{product.description}</p> : null}
        <span className="aacp-catalog-result-price">{formatCurrency(product.unit_price, currency)}</span>
      </div>
      <button
        type="button"
        className="aacp-catalog-result-add"
        disabled={loading || added}
        onClick={() => void handleAdd()}
      >
        {added ? (
          <>
            <Check size={12} />
            Adicionado
          </>
        ) : (
          <>
            <Plus size={12} />
            Adicionar
          </>
        )}
      </button>
    </article>
  );
}
