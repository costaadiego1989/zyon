import React from "react";
import { Plus, ShoppingBag, Trash2, Pencil, Upload, Pause, Play, Package, Sparkles } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { DataPanel } from "../components/DataPanel.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { FilterToolbar, FilterSelect } from "../components/FilterToolbar.js";
import { StatCard } from "./overview/components/StatCard.js";
import { CsvImportModal } from "../components/CsvImportModal.js";
import { AiSpreadsheetImportModal } from "../components/spreadsheet-import/AiSpreadsheetImportModal.js";
import { SectionErrorBoundary } from "../components/PageErrorBoundary.js";
import { useCatalogPage, totalStock } from "./catalog/useCatalogPage.js";

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

export { totalStock } from "./catalog/useCatalogPage.js";

export function CatalogPage(props: CatalogPageProps) {
  const vm = useCatalogPage({ me: props.me });

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
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Catálogo</h1>
          <p className="page-lead">Gerencie os produtos disponíveis na sua loja</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {vm.aiImportEnabled ? (
            <Button variant="outline" size="sm" onClick={() => vm.setShowCsvModal(true)}>
              <Sparkles size={14} /> Importar planilha (IA)
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => vm.setShowCsvModal(true)}>
              <Upload size={14} /> Importar CSV
            </Button>
          )}
          <Button variant="primary" size="sm" arrow onClick={() => props.onCreate?.()}>
            <Plus size={14} /> Novo produto
          </Button>
        </div>
      </header>

      {vm.pageError || vm.error ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--color-error-bg)", border: "1px solid var(--color-error)", font: "13px var(--font-sans)", color: "var(--color-error)", marginBottom: 16 }}>
          {vm.pageError ?? vm.error}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        <StatCard label="Produtos" value={vm.totals.total} icon={<Package size={16} />} />
        <StatCard label="Em estoque" value={vm.totals.inStock} icon={<ShoppingBag size={16} />} accent="var(--color-success)" />
        <StatCard label="Inativos" value={vm.totals.inactive} icon={<Pause size={16} />} accent="var(--color-text-faint)" />
      </div>

      <SectionErrorBoundary sectionName="Tabela do Catálogo">
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, overflow: "hidden" }}>
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "active", label: "Ativos" },
            { key: "inactive", label: "Inativos" },
          ]}
          activeTab={vm.statusFilter}
          onTabChange={(k) => vm.setStatusFilter(k as "all" | "active" | "inactive")}
          search={vm.search}
          onSearchChange={vm.setSearch}
          searchPlaceholder="Buscar por nome..."
          extra={
            vm.categories.length > 0 ? (
              <FilterSelect
                value={vm.categoryFilter}
                onChange={vm.setCategoryFilter}
                options={vm.categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Todas categorias"
              />
            ) : undefined
          }
        />

        <DataPanel
          title="Produtos"
          page={vm.page}
          pageSize={vm.pageSize}
          total={vm.total}
          onPageChange={vm.setPage}
          isEmpty={vm.filteredItems.length === 0 && !vm.loading}
          empty={{ icon: ShoppingBag, title: "Nenhum produto cadastrado", description: "Clique em 'Novo produto' para começar.", action: <Button variant="primary" size="sm" arrow onClick={() => props.onCreate?.()}><Plus size={14} /> Novo produto</Button> }}
        >
          {vm.loading ? (
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
                {vm.filteredItems.map((p) => {
                  const stock = totalStock(p);
                  const { price, currency } = variantPrice(p);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => props.onEdit?.(p.id)}
                      onMouseEnter={() => vm.setHoveredRow(p.id)}
                      onMouseLeave={() => vm.setHoveredRow(null)}
                      style={{ cursor: "pointer", background: vm.hoveredRow === p.id ? "var(--surface-1)" : "transparent", transition: "background 0.15s" }}
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
                            onClick={() => void vm.toggleActive(p)}
                            disabled={vm.togglingId === p.id}
                            aria-label={p.isActive ? `Pausar ${p.name}` : `Ativar ${p.name}`}
                            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: p.isActive ? "var(--color-text-muted)" : "var(--color-success)", cursor: vm.togglingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", opacity: vm.togglingId === p.id ? 0.6 : 1 }}
                          >
                            {p.isActive ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Ativar</>}
                          </button>
                          <button
                            type="button"
                            onClick={() => void vm.confirmDelete(p)}
                            disabled={vm.deletingId === p.id}
                            aria-label={`Remover ${p.name}`}
                            style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", cursor: vm.deletingId === p.id ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--font-sans)", opacity: vm.deletingId === p.id ? 0.6 : 1 }}
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

      {vm.aiImportEnabled ? (
        <AiSpreadsheetImportModal
          isOpen={vm.showCsvModal}
          onClose={() => vm.setShowCsvModal(false)}
          merchantId={props.me.id}
          onImportStarted={vm.onImportStarted}
        />
      ) : (
        <CsvImportModal
          isOpen={vm.showCsvModal}
          onClose={() => vm.setShowCsvModal(false)}
          onImport={vm.handleCsvImport}
        />
      )}

      <ConfirmDialog
        open={!!vm.deleteTarget}
        title={`Remover "${vm.deleteTarget?.name ?? ""}"?`}
        description="Esta ação não pode ser desfeita. O produto será removido permanentemente do catálogo."
        confirmLabel="Remover produto"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={vm.executeDelete}
        onCancel={vm.cancelDelete}
      />
    </div>
  );
}
