import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileVideo, MessageSquare, Star, XCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { Product } from "../../api/endpoints/catalog.js";
import { dashboardJson } from "../../api/http/client.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterSelect, FilterToolbar } from "../../components/FilterToolbar.js";
import { PageLoader } from "../../components/PageLoader.js";
import { SidePanel } from "../../components/SidePanel.js";
import { showToast } from "../../components/Toast.js";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";

type ReviewKind = "testimonial" | "video";
type ModerationStatus = "all" | "pending" | "approved" | "rejected";

interface ProductReview {
  id: string;
  kind: ReviewKind;
  productId: string;
  productName: string;
  source: string;
  moderationStatus: Exclude<ModerationStatus, "all">;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
  authorAvatarUrl?: string | null;
  body?: string;
  rating?: number | null;
  title?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
}

interface ReviewPageResponse {
  items: ProductReview[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ReviewsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const PAGE_SIZE = 20;

/** Merchant moderation inbox for buyer-written and buyer-video reviews. */
export function ReviewsPage({ apiBaseUrl, me }: ReviewsPageProps) {
  const catalog = useCatalogApi();
  const merchantId = me?.id;
  const [kind, setKind] = useState<ReviewKind>("testimonial");
  const [status, setStatus] = useState<ModerationStatus>("pending");
  const [productId, setProductId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [reviews, setReviews] = useState<ReviewPageResponse>({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProductReview | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ kind, page: String(page), pageSize: String(PAGE_SIZE) });
    if (status !== "all") params.set("moderationStatus", status);
    if (productId) params.set("productId", productId);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    try {
      const next = await dashboardJson<ReviewPageResponse>(
        apiBaseUrl,
        `/merchants/${encodeURIComponent(merchantId)}/reviews?${params.toString()}`,
        { method: "GET" },
      );
      setReviews(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar as avaliações.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, dateFrom, dateTo, kind, merchantId, page, productId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    setProductsLoading(true);
    catalog.listProducts(merchantId, { limit: 200 })
      .then((result) => {
        if (!cancelled) setProducts(result.products);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setProductsLoading(false);
      });
    return () => { cancelled = true; };
  }, [catalog, merchantId]);

  const resetPage = (change: () => void) => {
    change();
    setPage(1);
  };

  const moderate = async (review: ProductReview, nextStatus: "approved" | "rejected") => {
    if (!merchantId) return;
    setBusyId(review.id);
    try {
      const segment = review.kind === "testimonial" ? "testimonials" : "videos";
      await dashboardJson(
        apiBaseUrl,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(review.productId)}/${segment}/${encodeURIComponent(review.id)}/moderate`,
        { method: "POST", jsonBody: { moderationStatus: nextStatus, isPublished: nextStatus === "approved" } },
      );
      setSelected(null);
      showToast("success", nextStatus === "approved" ? "Avaliação aprovada e publicada." : "Avaliação rejeitada.");
      await load();
    } catch (caught) {
      showToast("error", caught instanceof Error ? caught.message : "Não foi possível atualizar a avaliação.");
    } finally {
      setBusyId(null);
    }
  };

  const panelTitle = selected?.kind === "video" ? "Avaliação em vídeo" : "Avaliação escrita";
  const currentProducts = useMemo(
    () => products.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [products],
  );

  if (!me) return null;

  return (
    <div>
      <header className="page-head">
        <div>
          <span className="eyebrow">LOJA</span>
          <h1>Avaliações</h1>
          <p className="page-lead">Revise contribuições dos compradores antes que apareçam na página do produto.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Atualizar</Button>
      </header>

      {error ? (
        <div role="alert" style={errorStyle}>
          <span>{error}</span>
          <Button variant="outline" onClick={() => void load()}>Tentar novamente</Button>
        </div>
      ) : null}

      <div className="panel" style={{ overflow: "hidden", padding: 0 }}>
        <FilterToolbar
          tabs={[
            { key: "testimonial", label: "Avaliações escritas" },
            { key: "video", label: "Vídeos" },
          ]}
          activeTab={kind}
          onTabChange={(next) => resetPage(() => setKind(next as ReviewKind))}
          extra={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <FilterSelect
                width={150}
                value={status}
                onChange={(next) => resetPage(() => setStatus(next as ModerationStatus))}
                options={[
                  { value: "all", label: "Todos os status" },
                  { value: "pending", label: "Pendentes" },
                  { value: "approved", label: "Aprovadas" },
                  { value: "rejected", label: "Rejeitadas" },
                ]}
              />
              <FilterSelect
                width={210}
                value={productId}
                onChange={(next) => resetPage(() => setProductId(next))}
                options={currentProducts.map((product) => ({ value: product.id, label: product.name }))}
                placeholder={productsLoading ? "Carregando produtos..." : "Todos os produtos"}
              />
              <DateFilter label="De" value={dateFrom} onChange={(next) => resetPage(() => setDateFrom(next))} />
              <DateFilter label="Até" value={dateTo} onChange={(next) => resetPage(() => setDateTo(next))} />
            </div>
          }
        />

        {loading ? <PageLoader /> : (
          <DataPanel
            title={kind === "video" ? "Vídeos enviados por clientes" : "Avaliações enviadas por clientes"}
            page={reviews.page}
            pageSize={reviews.pageSize}
            total={reviews.total}
            onPageChange={setPage}
            isEmpty={reviews.items.length === 0}
            empty={{
              icon: kind === "video" ? FileVideo : MessageSquare,
              title: status === "pending" ? "Nenhuma avaliação pendente" : "Nenhuma avaliação encontrada",
              description: status === "pending"
                ? "Quando um cliente enviar uma avaliação, ela aparecerá aqui para sua decisão."
                : "Ajuste os filtros para consultar outras avaliações.",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {[
                    kind === "video" ? "VÍDEO" : "CLIENTE",
                    "PRODUTO",
                    "STATUS",
                    "ENVIADA EM",
                    "",
                  ].map((label) => <th key={label} style={headerCellStyle}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {reviews.items.map((review) => (
                  <tr key={review.id}>
                    <td style={bodyCellStyle}>
                      {review.kind === "video" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><FileVideo size={16} /> {review.title || "Vídeo sem título"}</span>
                      ) : (
                        <div>
                          <strong style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>{review.authorName || "Cliente"}</strong>
                          <ReviewRating value={review.rating} />
                        </div>
                      )}
                    </td>
                    <td style={bodyCellStyle}>{review.productName}</td>
                    <td style={bodyCellStyle}><StatusBadge value={review.moderationStatus} /></td>
                    <td style={bodyCellStyle}>{formatDate(review.createdAt)}</td>
                    <td style={{ ...bodyCellStyle, textAlign: "right" }}>
                      <Button variant="outline" onClick={() => setSelected(review)}>Ver</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        )}
      </div>

      <SidePanel isOpen={Boolean(selected)} title={panelTitle} onClose={() => setSelected(null)}>
        {selected ? (
          <ReviewInspector review={selected} busy={busyId === selected.id} onModerate={moderate} />
        ) : null}
      </SidePanel>
    </div>
  );
}

function ReviewInspector({ review, busy, onModerate }: { review: ProductReview; busy: boolean; onModerate: (review: ProductReview, status: "approved" | "rejected") => Promise<void> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={detailCardStyle}>
        <Detail label="Produto" value={review.productName} />
        <Detail label="Enviada em" value={formatDate(review.createdAt, true)} />
        <Detail label="Status" value={<StatusBadge value={review.moderationStatus} />} />
      </div>

      {review.kind === "testimonial" ? (
        <>
          <div style={detailCardStyle}>
            <Detail label="Cliente" value={review.authorName || "Cliente"} />
            <Detail label="Nota" value={<ReviewRating value={review.rating} expanded />} />
          </div>
          <section>
            <p style={detailLabelStyle}>AVALIAÇÃO</p>
            <p style={{ margin: 0, color: "var(--color-text)", font: "14px/1.65 var(--font-sans)", whiteSpace: "pre-wrap" }}>{review.body}</p>
          </section>
        </>
      ) : (
        <section>
          <p style={detailLabelStyle}>VÍDEO</p>
          <h3 style={{ margin: "0 0 10px", color: "var(--color-text)", font: "600 15px var(--font-sans)" }}>{review.title || "Vídeo sem título"}</h3>
          {review.videoUrl ? (
            <video controls preload="metadata" src={review.videoUrl} style={{ display: "block", width: "100%", borderRadius: 10, background: "#000" }}>
              Seu navegador não suporta a reprodução deste vídeo.
            </video>
          ) : null}
        </section>
      )}

      {review.moderationStatus === "pending" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
          <Button variant="outline" onClick={() => void onModerate(review, "rejected")} disabled={busy}><XCircle size={16} /> Rejeitar</Button>
          <Button onClick={() => void onModerate(review, "approved")} disabled={busy}><CheckCircle2 size={16} /> Aprovar</Button>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 4 }}><span style={detailLabelStyle}>{label}</span><span style={{ color: "var(--color-text)", font: "13px var(--font-sans)" }}>{value}</span></div>;
}

function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, width: 166, height: 32, boxSizing: "border-box", padding: "0 8px 0 10px", border: "1px solid var(--color-border)", borderRadius: 7, color: "var(--color-text-muted)", font: "600 11px var(--font-sans)", background: "var(--surface-1)" }}>
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Data ${label}`} style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: "var(--color-text)", font: "12px var(--font-sans)" }} />
    </label>
  );
}

function ReviewRating({ value, expanded = false }: { value?: number | null; expanded?: boolean }) {
  if (typeof value !== "number" || value < 1 || value > 5) return <span style={{ color: "var(--color-text-faint)", font: "12px var(--font-sans)" }}>Sem nota</span>;
  return <span aria-label={`${value} de 5 estrelas`} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--color-warning, #D97706)", marginTop: expanded ? 0 : 4 }}>{Array.from({ length: value }).map((_, index) => <Star key={index} size={expanded ? 16 : 12} fill="currentColor" />)}</span>;
}

function StatusBadge({ value }: { value: Exclude<ModerationStatus, "all"> }) {
  const labels = { pending: "Pendente", approved: "Aprovada", rejected: "Rejeitada" } as const;
  const color = value === "approved" ? "var(--color-success)" : value === "rejected" ? "var(--color-error)" : "var(--color-warning, #D97706)";
  return <span style={{ display: "inline-flex", alignItems: "center", minHeight: 24, padding: "0 8px", borderRadius: 999, color, background: `color-mix(in srgb, ${color} 14%, transparent)`, font: "700 10.5px var(--font-mono)", letterSpacing: "0.02em" }}>{labels[value]}</span>;
}

function formatDate(value: string, withTime = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("pt-BR", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}

const headerCellStyle: React.CSSProperties = { textAlign: "left", padding: "10px 20px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-faint)", font: "600 10.5px var(--font-mono)", letterSpacing: "0.05em" };
const bodyCellStyle: React.CSSProperties = { padding: "13px 20px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)", font: "13px var(--font-sans)", verticalAlign: "middle" };
const errorStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, padding: "12px 16px", border: "1px solid var(--color-error)", borderRadius: 10, background: "var(--color-error-bg)", color: "var(--color-error)", font: "13px var(--font-sans)" };
const detailCardStyle: React.CSSProperties = { display: "grid", gap: 14, padding: 14, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--surface-2)" };
const detailLabelStyle: React.CSSProperties = { color: "var(--color-text-faint)", font: "600 10px var(--font-mono)", letterSpacing: "0.06em" };
