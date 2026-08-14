import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, ShoppingBag, Trash2, Pencil, Upload } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { useCursorPagination } from "../hooks/useCursorPagination.js";

export interface CatalogPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  onCreate?: () => void;
  onEdit?: (productId: string) => void;
}

export function formatPrice(cents: number, currency: string): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function variantPrice(product: Product): { price: number; currency: string } {
  const first = product.variants?.[0];
  if (!first) return { price: 0, currency: "BRL" };
  return { price: first.basePriceInCents, currency: first.currency };
}

export function totalStock(product: Product): number {
  return product.variants.reduce(
    (sum, v) => sum + (v.stockQuantity ?? 0) - (v.stockReserved ?? 0),
    0,
  );
}

export function CatalogPage(props: CatalogPageProps) {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const merchantId = props.me?.id;

  const fetcher = useCallback(
    async (cursor?: string) => {
      if (!merchantId) {
        return { products: [], nextCursor: undefined, total: 0 };
      }
      return api.listProducts(merchantId, {
        query: search || undefined,
        inStockOnly: inStockOnly || undefined,
        limit: 30,
        cursor,
      });
    },
    [api, merchantId, search, inStockOnly],
  );

  const adapted = useCallback(
    async (cursor?: string) => {
      const result = await fetcher(cursor);
      return {
        data: result.products,
        next_cursor: result.nextCursor ?? null,
        has_more: result.nextCursor !== undefined,
      };
    },
    [fetcher],
  );

  const { items, hasMore, loading, loadingMore, error, load, loadMore } =
    useCursorPagination<Product>(adapted);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const total = items.length;
    const inStock = items.filter((p) => totalStock(p) > 0).length;
    const inactive = items.filter((p) => !p.isActive).length;
    return { total, inStock, inactive };
  }, [items]);

  async function confirmDelete(product: Product) {
    const ok = window.confirm(`Remover "${product.name}"? Esta ação não pode ser desfeita.`);
    if (!ok) return;
    if (!merchantId) return;
    setDeletingId(product.id);
    setPageError(null);
    try {
      await api.deleteProduct(merchantId, product.id);
      await load();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !merchantId) return;

    setCsvImporting(true);
    setPageError(null);
    setCsvProgress(null);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) {
        setPageError("CSV vazio ou sem dados.");
        return;
      }

      // Parse header
      const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
      const nameIdx = header.indexOf("name");
      const skuIdx = header.indexOf("sku");
      const priceIdx = header.indexOf("price");
      const stockIdx = header.indexOf("stock");
      const weightIdx = header.indexOf("weight");
      const descIdx = header.indexOf("description");

      if (nameIdx === -1 || skuIdx === -1 || priceIdx === -1) {
        setPageError("CSV deve conter ao menos as colunas: name, sku, price");
        return;
      }

      const dataRows = lines.slice(1);
      const total = dataRows.length;
      setCsvProgress({ done: 0, total });

      for (let i = 0; i < dataRows.length; i++) {
        const cols = dataRows[i]!.split(",").map((c) => c.trim());
        const name = cols[nameIdx] || `Produto ${i + 1}`;
        const sku = cols[skuIdx] || `SKU-${Date.now()}-${i}`;
        const price = Math.round(parseFloat(cols[priceIdx] || "0") * 100);
        const stock = stockIdx >= 0 ? parseInt(cols[stockIdx] || "0", 10) : 0;
        const weight = weightIdx >= 0 ? parseInt(cols[weightIdx] || "0", 10) : undefined;
        const description = descIdx >= 0 ? cols[descIdx] : undefined;

        try {
          await api.createProduct(merchantId, {
            name,
            description: description || undefined,
            variants: [{
              sku,
              basePriceInCents: price,
              stockQuantity: stock,
              weightGrams: weight,
            }],
          });
        } catch {
          // Continue importing remaining rows
        }

        setCsvProgress({ done: i + 1, total });
      }

      await load();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setCsvImporting(false);
      setCsvProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!props.me) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Catálogo</h1>
            <p className="page-lead">Login necessário.</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Catálogo</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Gerencie os produtos disponíveis na sua loja.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => void handleCsvImport(e)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={csvImporting}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", font: "600 12.5px var(--sans)", color: "var(--ink)", cursor: csvImporting ? "not-allowed" : "pointer", flex: "none", opacity: csvImporting ? 0.6 : 1 }}
          >
            <Upload size={14} /> {csvImporting && csvProgress ? `${csvProgress.done}/${csvProgress.total}` : "Importar CSV"}
          </button>
          <button
            type="button"
            onClick={() => props.onCreate?.()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: "pointer", flex: "none" }}
          >
            <Plus size={14} /> Novo produto
          </button>
        </div>
      </div>

      {pageError || error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
          {pageError ?? error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { label: "PRODUTOS", value: totals.total },
          { label: "EM ESTOQUE", value: totals.inStock },
          { label: "INATIVOS", value: totals.inactive },
        ].map((st) => (
          <div key={st.label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.07em", color: "var(--faint)", marginBottom: 12 }}>{st.label}</div>
            <div style={{ font: "500 26px var(--serif)", color: "var(--ink)", letterSpacing: "-0.01em" }}>{st.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {(["all", "in-stock"] as const).map((value) => {
              const active = value === "all" ? !inStockOnly : inStockOnly;
              const labels = { all: "Todos", "in-stock": "Em estoque" };
              return (
                <div
                  key={value}
                  onClick={() => setInStockOnly(value === "in-stock")}
                  style={{ padding: "7px 14px", borderRadius: 8, font: "600 12.5px var(--sans)", cursor: "pointer", background: active ? "var(--accent-dark)" : "var(--card)", color: active ? "white" : "var(--ink)", border: `1px solid ${active ? "var(--accent-dark)" : "var(--border)"}` }}
                >
                  {labels[value]}
                </div>
              );
            })}
          </div>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }} />
            <input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280, padding: "8px 12px 8px 30px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando produtos...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <ShoppingBag size={32} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhum produto cadastrado.</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Clique em "Novo produto" para começar.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["NOME", "PREÇO", "ESTOQUE", "STATUS", ""].map((c) => (
                  <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const stock = totalStock(p);
                const { price, currency } = variantPrice(p);
                return (
                  <tr key={p.id}>
                    <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{p.name}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{formatPrice(price, currency)}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: stock > 0 ? "var(--good)" : "var(--danger)", borderBottom: "1px solid var(--border)" }}>{stock}</td>
                    <td style={{ padding: "12px 22px", font: "12px var(--mono)", color: p.isActive ? "var(--good)" : "var(--faint)", borderBottom: "1px solid var(--border)" }}>{p.isActive ? "Ativo" : "Inativo"}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => props.onEdit?.(p.id)}
                          aria-label={`Editar ${p.name}`}
                          style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmDelete(p)}
                          disabled={deletingId === p.id}
                          aria-label={`Remover ${p.name}`}
                          style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: deletingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)", opacity: deletingId === p.id ? 0.6 : 1 }}
                        >
                          <Trash2 size={12} /> Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {hasMore ? (
          <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: loadingMore ? "not-allowed" : "pointer", font: "600 12.5px var(--sans)" }}
            >
              {loadingMore ? "Carregando..." : "Carregar mais"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}