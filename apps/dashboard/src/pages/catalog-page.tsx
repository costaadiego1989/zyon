import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ShoppingBag, Trash2, Pencil, Upload, Pause, Play, Package } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { useCatalogApi } from "../hooks/api/useCatalogApi.js";
import { DataPanel } from "../components/DataPanel.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { FilterToolbar, FilterSelect } from "../components/FilterToolbar.js";
import { StatCard } from "./overview/components/StatCard.js";
import { CsvImportModal, type CsvRow } from "../components/CsvImportModal.js";
import { SectionErrorBoundary } from "../components/PageErrorBoundary.js";

export interface CatalogPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  onCreate?: () => void;
  onEdit?: (productId: string) => void;
}

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  simple: "Simples",
  physical: "Simples",
  variable: "Variável",
  digital: "Digital",
  service: "Serviço",
  food: "Alimentação",
};

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
  const catalog = useCatalogApi();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
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
    catalog.listCategories?.(merchantId).then(setCategories).catch(() => {});
  }, [catalog, merchantId]);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await catalog.listProducts(merchantId, {
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
  }, [catalog, merchantId, search, categoryFilter, page]);

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

  const totals = useMemo(() => {
    const totalCount = total;
    const inStock = filteredItems.filter((p) => totalStock(p) > 0).length;
    const inactive = filteredItems.filter((p) => !p.isActive).length;
    return { total: totalCount, inStock, inactive };
  }, [filteredItems, total]);

  async function confirmDelete(product: Product) {
    setDeleteTarget(product);
  }

  async function executeDelete() {
    if (!deleteTarget || !merchantId) return;
    setDeletingId(deleteTarget.id);
    setDeleteTarget(null);
    setPageError(null);
    try {
      await catalog.deleteProduct(merchantId, deleteTarget.id);
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
      await catalog.updateProduct(merchantId, product.id, { isActive: !product.isActive });
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
        await catalog.createProduct(merchantId, {
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
            <span className="eyebrow">Loja</span>
            <h1>Catálogo</h1>
            <p className="page-lead">Login necessário</p>
          </div>
        </header>
      </>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <header className="page-head">
          <div>
            <span className="eyebrow">Loja</span>
            <h1>Catálogo</h1>
            <p className="page-lead">Gerencie os produtos disponíveis na sua loja</p>
          </div>
        </header>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="outline" size="sm" onClick={() => setShowCsvModal(true)}>
            <Upload size={14} /> Importar CSV
          </Button>
          <Button variant="primary" size="sm" arrow onClick={() => props.onCreate?.()}>
            <Plus size={14} /> Novo produto
          </Button>
        </div>
      </div>

      {pageError || error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error)", font: "13px var(--font-sans)", color: "var(--color-error)", marginBottom: 16 }}>
          {pageError ?? error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        <StatCard label="Produtos" value={totals.total} icon={<Package size={16} />} />
        <StatCard label="Em estoque" value={totals.inStock} icon={<ShoppingBag size={16} />} accent="var(--color-success)" />
        <StatCard label="Inativos" value={totals.inactive} icon={<Pause size={16} />} accent="var(--color-text-faint)" />
      </div>

      <SectionErrorBoundary sectionName="Tabela do Catálogo">
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, overflow: "hidden" }}>
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

        <DataPanel
          title="Produtos"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          isEmpty={filteredItems.length === 0 && !loading}
          empty={{ icon: ShoppingBag, title: "Nenhum produto cadastrado", description: "Clique em 'Novo produto' para começar.", action: <Button variant="primary" size="sm" arrow onClick={() => props.onCreate?.()}><Plus size={14} /> Novo produto</Button> }}
        >
          {loading ? (
            <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando produtos...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["NOME", "TIPO", "PREÇO", "ESTOQUE", "STATUS", ""].map((c) => (
                    <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--font-mono)", letterSpacing: "0.05em", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>{c}</th>
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
                      style={{ cursor: "pointer", background: hoveredRow === p.id ? "var(--surface-1)" : "transparent", transition: "background 0.15s" }}
                    >
                      <td style={{ padding: "12px 22px", font: "13px var(--font-sans)", color: "var(--color-text)", borderBottom: "1px solid var(--color-border)" }}>{p.name}</td>
                      <td style={{ padding: "12px 22px", font: "11px var(--font-mono)", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>{PRODUCT_TYPE_LABELS[p.type ?? "simple"] || p.type || "—"}</td>
                      <td style={{ padding: "12px 22px", font: "13px var(--font-mono)", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>{formatPrice(price, currency)}</td>
                      <td style={{ padding: "12px 22px", font: "13px var(--font-mono)", color: stock > 0 ? "var(--color-success)" : "var(--color-error)", borderBottom: "1px solid var(--color-border)" }}>{stock}</td>
                      <td style={{ padding: "12px 22px", font: "12px var(--font-mono)", color: p.isActive ? "var(--color-success)" : "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>{p.isActive ? "Ativo" : "Inativo"}</td>
                      <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => props.onEdit?.(p.id)}
                            aria-label={`Editar ${p.name}`}
                            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)" }}
                          >
                            <Pencil size={12} /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleActive(p)}
                            disabled={togglingId === p.id}
                            aria-label={p.isActive ? `Pausar ${p.name}` : `Ativar ${p.name}`}
                            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: p.isActive ? "var(--color-text-muted)" : "var(--color-success)", cursor: togglingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", opacity: togglingId === p.id ? 0.6 : 1 }}
                          >
                            {p.isActive ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Ativar</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => void confirmDelete(p)}
                            disabled={deletingId === p.id}
                            aria-label={`Remover ${p.name}`}
                            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", cursor: deletingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", opacity: deletingId === p.id ? 0.6 : 1 }}
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
        </DataPanel>
      </div>
      </SectionErrorBoundary>

      <CsvImportModal
        isOpen={showCsvModal}
        onClose={() => setShowCsvModal(false)}
        onImport={handleCsvImport}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Remover "${deleteTarget?.name ?? ""}"?`}
        description="Esta ação não pode ser desfeita. O produto será removido permanentemente do catálogo."
        confirmLabel="Remover produto"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}