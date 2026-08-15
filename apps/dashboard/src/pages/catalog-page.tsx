import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShoppingBag, Trash2, Pencil, Upload, Pause, Play, Package } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { Pagination } from "../components/Pagination.js";
import { FilterToolbar, FilterSelect } from "../components/FilterToolbar.js";
import { StatCard } from "./overview/components/StatCard.js";
import { CsvImportModal, type CsvRow } from "../components/CsvImportModal.js";

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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  // Page-based pagination
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const merchantId = props.me?.id;

  useEffect(() => {
    if (!merchantId) return;
    api.listCategories?.(merchantId).then(setCategories).catch(() => {});
  }, [api, merchantId]);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.listProducts(merchantId, {
        query: search || undefined,
        categoryId: categoryFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setItems(result.products);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, merchantId, search, categoryFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter]);

  // Client-side status filter
  const filteredItems = useMemo(() => {
    if (statusFilter === "all") return items;
    if (statusFilter === "active") return items.filter(p => p.isActive);
    return items.filter(p => !p.isActive);
  }, [items, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const totalCount = total;
    const inStock = filteredItems.filter((p) => totalStock(p) > 0).length;
    const inactive = filteredItems.filter((p) => !p.isActive).length;
    return { total: totalCount, inStock, inactive };
  }, [filteredItems, total]);

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

  async function toggleActive(product: Product) {
    if (!merchantId) return;
    setTogglingId(product.id);
    setPageError(null);
    try {
      await api.updateProduct(merchantId, product.id, { isActive: !product.isActive });
      await load();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleCsvImport(rows: CsvRow[]) {
    if (!merchantId) throw new Error("Merchant ID não disponível");

    setPageError(null);

    for (const row of rows) {
      try {
        await api.createProduct(merchantId, {
          name: row.name,
          description: row.description || undefined,
          categoryId: row.category ? row.category : undefined,
          variants: [{
            sku: row.sku,
            basePriceInCents: Math.round(row.price * 100),
            stockQuantity: row.stock ?? 0,
            weightGrams: row.weight_grams,
            lengthCm: row.length_cm,
            widthCm: row.width_cm,
            heightCm: row.height_cm,
          }],
        });
      } catch (e) {
        // Continue importing remaining rows
      }
    }

    await load();
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
          <button
            type="button"
            onClick={() => setShowCsvModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", font: "600 12.5px var(--sans)", color: "var(--ink)", cursor: "pointer", flex: "none" }}
          >
            <Upload size={14} /> Importar CSV
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
        <StatCard label="Produtos" value={totals.total} icon={<Package size={16} />} />
        <StatCard label="Em estoque" value={totals.inStock} icon={<ShoppingBag size={16} />} accent="var(--good)" />
        <StatCard label="Inativos" value={totals.inactive} icon={<Pause size={16} />} accent="var(--faint)" />
      </div>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "active", label: "Ativos" },
            { key: "inactive", label: "Inativos" },
          ]}
          activeTab={statusFilter}
          onTabChange={(k) => setStatusFilter(k as "all" | "active" | "inactive")}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por nome..."
          extra={
            categories.length > 0 ? (
              <FilterSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Todas categorias"
              />
            ) : undefined
          }
        />

        {loading ? (
          <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando produtos...</div>
        ) : filteredItems.length === 0 ? (
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
              {filteredItems.map((p) => {
                const stock = totalStock(p);
                const { price, currency } = variantPrice(p);
                return (
                  <tr
                    key={p.id}
                    onClick={() => props.onEdit?.(p.id)}
                    onMouseEnter={() => setHoveredRow(p.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{ cursor: "pointer", background: hoveredRow === p.id ? "var(--bg)" : "transparent", transition: "background 0.15s" }}
                  >
                    <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{p.name}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{formatPrice(price, currency)}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: stock > 0 ? "var(--good)" : "var(--danger)", borderBottom: "1px solid var(--border)" }}>{stock}</td>
                    <td style={{ padding: "12px 22px", font: "12px var(--mono)", color: p.isActive ? "var(--good)" : "var(--faint)", borderBottom: "1px solid var(--border)" }}>{p.isActive ? "Ativo" : "Inativo"}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
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
                          onClick={() => void toggleActive(p)}
                          disabled={togglingId === p.id}
                          aria-label={p.isActive ? `Pausar ${p.name}` : `Ativar ${p.name}`}
                          style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: p.isActive ? "var(--muted)" : "var(--good)", cursor: togglingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)", opacity: togglingId === p.id ? 0.6 : 1 }}
                        >
                          {p.isActive ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Ativar</>}
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

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
          disabled={loading}
        />
      </div>

      <CsvImportModal
        isOpen={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        onImport={handleCsvImport}
      />
    </div>
  );
}