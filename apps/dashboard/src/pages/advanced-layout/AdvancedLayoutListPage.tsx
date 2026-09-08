import React, { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Pencil, Layers, MessageSquare, Star, Video } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { Product, ProductLayoutStatusEntry } from "../../api/endpoints/catalog.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { PageLoader } from "../../components/PageLoader.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";

export interface AdvancedLayoutListPageProps {
  me: MerchantProfile;
  onEditProduct?: (productId: string) => void;
}

type SortKey = "name-asc" | "name-desc" | "updated-desc" | "updated-asc" | "blocks-desc";
type StatusFilter = "all" | "configured" | "empty";

/**
 * Catalog → Conteúdo Avançado — Wave 2 list page (R5 of the Advanced
 * Product Layout spec).
 *
 * Lists every active product for the merchant and surfaces, per row,
 * a summary of the per-product content surface (block count +
 * FAQ / testimonial / video counts + last update). Selecting "Editar"
 * jumps into the existing ProductDetailPage where the Wave 2
 * BlockEditor lives — keeping this page a thin browseable index
 * so the editor surface stays focused on one product at a time.
 */
export function AdvancedLayoutListPage({ me, onEditProduct }: AdvancedLayoutListPageProps) {
  const catalog = useCatalogApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [statuses, setStatuses] = useState<ProductLayoutStatusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("updated-desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      catalog.listProducts(me.id, { limit: 200 }),
      catalog.getProductsWithLayoutStatus(me.id).catch(() => ({ entries: [], total: 0 })),
    ])
      .then(([productResult, layoutResult]) => {
        if (cancelled) return;
        setProducts(productResult.products.filter((p) => p.isActive));
        setStatuses(layoutResult.entries);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Não foi possível carregar os produtos.";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalog, me.id]);

  const statusByProduct = useMemo(() => {
    const map = new Map<string, ProductLayoutStatusEntry>();
    statuses.forEach((s) => map.set(s.productId, s));
    return map;
  }, [statuses]);

  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    products.forEach((p) => {
      if (p.categoryId) map.set(p.categoryId, { id: p.categoryId, name: p.categoryId });
    });
    return Array.from(map.values());
  }, [products]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = products
      .map((p) => ({ product: p, status: statusByProduct.get(p.id) }))
      .filter(({ product }) => {
        if (needle && !product.name.toLowerCase().includes(needle)) return false;
        if (categoryFilter && product.categoryId !== categoryFilter) return false;
        const blockCount = statusByProduct.get(product.id)?.blockCount ?? 0;
        if (statusFilter === "configured" && blockCount === 0) return false;
        if (statusFilter === "empty" && blockCount > 0) return false;
        return true;
      });
    rows.sort((a, b) => {
      const aStatus = a.status;
      const bStatus = b.status;
      switch (sort) {
        case "name-asc":
          return a.product.name.localeCompare(b.product.name, "pt-BR");
        case "name-desc":
          return b.product.name.localeCompare(a.product.name, "pt-BR");
        case "blocks-desc":
          return (bStatus?.blockCount ?? 0) - (aStatus?.blockCount ?? 0);
        case "updated-asc": {
          const at = aStatus?.lastUpdatedAt ? Date.parse(aStatus.lastUpdatedAt) : 0;
          const bt = bStatus?.lastUpdatedAt ? Date.parse(bStatus.lastUpdatedAt) : 0;
          return at - bt;
        }
        case "updated-desc":
        default: {
          const at = aStatus?.lastUpdatedAt ? Date.parse(aStatus.lastUpdatedAt) : 0;
          const bt = bStatus?.lastUpdatedAt ? Date.parse(bStatus.lastUpdatedAt) : 0;
          return bt - at;
        }
      }
    });
    return rows;
  }, [products, statusByProduct, search, categoryFilter, statusFilter, sort]);

  const totals = useMemo(() => {
    let configured = 0;
    let totalBlocks = 0;
    statuses.forEach((s) => {
      if (s.blockCount > 0) configured += 1;
      totalBlocks += s.blockCount;
    });
    return {
      products: products.length,
      configured,
      totalBlocks,
    };
  }, [products, statuses]);

  return (
    <div>
      <SectionHeader
        title="Conteúdo Avançado"
        subtitle="Catálogo · Monte páginas de produto ricas com blocos estruturados, FAQ, depoimentos e vídeos."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        <SummaryCard icon={<LayoutGrid size={16} />} label="Produtos ativos" value={totals.products} />
        <SummaryCard
          icon={<Layers size={16} />}
          label="Com conteúdo"
          value={totals.configured}
          accent="var(--color-success)"
        />
        <SummaryCard icon={<Layers size={16} />} label="Blocos publicados" value={totals.totalBlocks} />
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "var(--color-error-bg)",
            border: "1px solid var(--color-error)",
            font: "13px var(--font-sans)",
            color: "var(--color-error)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <FilterToolbar
          tabs={[
            { key: "all", label: "Todos" },
            { key: "configured", label: "Com conteúdo" },
            { key: "empty", label: "Sem conteúdo" },
          ]}
          activeTab={statusFilter}
          onTabChange={(k) => setStatusFilter(k as StatusFilter)}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por nome..."
          extra={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {categories.length > 0 ? (
                <FilterSelect
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Todas categorias"
                />
              ) : null}
              <SortSelect value={sort} onChange={setSort} />
            </div>
          }
        />

        {loading ? (
          <PageLoader />
        ) : (
          <DataPanel
            title="Produtos"
            page={1}
            pageSize={filtered.length || 1}
            total={filtered.length}
            onPageChange={() => undefined}
            isEmpty={filtered.length === 0}
            empty={{
              icon: LayoutGrid,
              title: products.length === 0 ? "Nenhum produto ativo" : "Nenhum resultado para essa busca",
              description:
                products.length === 0
                  ? "Cadastre um produto no Catálogo para começar a montar o conteúdo avançado."
                  : "Ajuste os filtros para ver outros produtos.",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["PRODUTO", "BLOCOS", "FAQ", "DEPOIMENTOS", "VÍDEOS", "ATUALIZADO", ""].map((c) => (
                    <th
                      key={c}
                      style={{
                        textAlign: "left",
                        padding: "10px 22px",
                        font: "600 10.5px var(--font-mono)",
                        letterSpacing: "0.05em",
                        color: "var(--color-text-faint)",
                        borderBottom: "1px solid var(--color-border)",
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ product, status }) => {
                  const firstMedia = product.variants?.[0]?.media?.[0]?.url;
                  return (
                    <tr
                      key={product.id}
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      <td
                        style={{
                          padding: "12px 22px",
                          font: "13px var(--font-sans)",
                          color: "var(--color-text)",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            aria-hidden
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              border: "1px solid var(--color-border)",
                              background: "var(--surface-1)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              overflow: "hidden",
                            }}
                          >
                            {firstMedia ? (
                              <img
                                src={firstMedia}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <LayoutGrid size={16} color="var(--color-text-faint)" />
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                font: "600 13px var(--font-sans)",
                                color: "var(--color-text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 320,
                              }}
                            >
                              {product.name}
                            </div>
                            <div
                              style={{
                                font: "11px var(--font-mono)",
                                color: "var(--color-text-faint)",
                                marginTop: 2,
                              }}
                            >
                              {status?.enabledBlockCount
                                ? `${status.enabledBlockCount} publicados`
                                : "Sem blocos"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={cellStyle}>
                        <BlockBadge count={status?.blockCount ?? 0} />
                      </td>
                      <td style={cellStyle}>
                        <CountCell icon={<MessageSquare size={12} />} value={status?.faqCount ?? 0} />
                      </td>
                      <td style={cellStyle}>
                        <CountCell icon={<Star size={12} />} value={status?.testimonialCount ?? 0} />
                      </td>
                      <td style={cellStyle}>
                        <CountCell icon={<Video size={12} />} value={status?.videoCount ?? 0} />
                      </td>
                      <td
                        style={{
                          ...cellStyle,
                          color: "var(--color-text-faint)",
                          font: "12px var(--font-mono)",
                        }}
                      >
                        {status?.lastUpdatedAt ? formatRelative(status.lastUpdatedAt) : "—"}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => onEditProduct?.(product.id)}
                          aria-label={`Editar layout de ${product.name}`}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--color-border)",
                            background: "var(--surface-2)",
                            color: "var(--color-text)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            font: "600 11.5px var(--font-sans)",
                          }}
                        >
                          <Pencil size={12} /> Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataPanel>
        )}
      </div>
    </div>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "12px 22px",
  font: "13px var(--font-mono)",
  color: "var(--color-text-muted)",
  borderBottom: "1px solid var(--color-border)",
};

function BlockBadge({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 999,
          background: "var(--color-text-faint)",
          color: "var(--surface-1)",
          font: "600 11px var(--font-mono)",
          opacity: 0.45,
        }}
      >
        0
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: "color-mix(in oklab, var(--color-success, #16A34A) 12%, transparent)",
        color: "var(--color-success, #16A34A)",
        font: "600 11px var(--font-mono)",
      }}
    >
      {count}
    </span>
  );
}

function CountCell({ icon, value }: { icon: React.ReactNode; value: number }) {
  if (value === 0) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text-faint)" }}>
        {icon}
        —
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {icon}
      {value}
    </span>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (next: SortKey) => void;
}) {
  return (
    <FilterSelect
      value={value}
      onChange={(next) => onChange(next as SortKey)}
      options={[
        { value: "updated-desc", label: "Atualização ↓" },
        { value: "updated-asc", label: "Atualização ↑" },
        { value: "name-asc", label: "Nome A→Z" },
        { value: "name-desc", label: "Nome Z→A" },
        { value: "blocks-desc", label: "Mais blocos" },
      ]}
      placeholder="Ordenar"
    />
  );
}

function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-text-faint)" }}>
        {icon}
        <span style={{ font: "600 10.5px var(--font-mono)", letterSpacing: "0.05em" }}>{label.toUpperCase()}</span>
      </div>
      <div
        style={{
          font: "700 24px var(--font-sans)",
          color: accent ?? "var(--color-text)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  return new Date(then).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
