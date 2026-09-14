import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileVideo, MessageSquare, Star, XCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { Product } from "../../api/endpoints/catalog.js";
import { dashboardJson } from "../../api/http/client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import { PageLoader } from "../../components/PageLoader.js";
import { Pagination } from "../../components/Pagination.js";
import { PeriodFilter } from "../../components/PeriodFilter.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { SidePanel } from "../../components/SidePanel.js";
import { showToast } from "../../components/Toast.js";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";
import { StatCard, StatCardGroup } from "../overview/components/StatCard.js";
import "./reviews.css";

type ReviewKind = "testimonial" | "video";
type ModerationStatus = "all" | "pending" | "approved" | "rejected";
type ReviewStatus = Exclude<ModerationStatus, "all">;
type ReviewPeriod = "all" | "today" | "7d" | "15d" | "30d";

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

interface ReviewStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface ReviewsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const PAGE_SIZE = 20;
const EMPTY_REVIEW_STATS: ReviewStats = { total: 0, pending: 0, approved: 0, rejected: 0 };
const PERIOD_PRESETS = [
  { key: "all", label: "Todos" },
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "15d", label: "Últimos 15 dias" },
  { key: "30d", label: "Últimos 30 dias" },
] as const;

/** Merchant moderation inbox for buyer-written and buyer-video reviews. */
export function ReviewsPage({ apiBaseUrl, me }: ReviewsPageProps) {
  const catalog = useCatalogApi();
  const merchantId = me?.id;
  const [kind, setKind] = useState<ReviewKind>("testimonial");
  const [status, setStatus] = useState<ModerationStatus>("pending");
  const [productId, setProductId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [period, setPeriod] = useState<ReviewPeriod>("all");
  const [page, setPage] = useState(1);
  const [reviews, setReviews] = useState<ReviewPageResponse>({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
  const [stats, setStats] = useState<ReviewStats>(EMPTY_REVIEW_STATS);
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
    const requestReviews = (moderationStatus?: ReviewStatus, requestedPage = 1, requestedPageSize = 1) => {
      const params = new URLSearchParams({ kind, page: String(requestedPage), pageSize: String(requestedPageSize) });
      if (moderationStatus) params.set("moderationStatus", moderationStatus);
      if (productId) params.set("productId", productId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return dashboardJson<ReviewPageResponse>(
        apiBaseUrl,
        `/merchants/${encodeURIComponent(merchantId)}/reviews?${params.toString()}`,
        { method: "GET" },
      );
    };
    try {
      const [next, total, pending, approved, rejected] = await Promise.all([
        requestReviews(status === "all" ? undefined : status, page, PAGE_SIZE),
        requestReviews(),
        requestReviews("pending"),
        requestReviews("approved"),
        requestReviews("rejected"),
      ]);
      setReviews(next);
      setStats({
        total: total.total,
        pending: pending.total,
        approved: approved.total,
        rejected: rejected.total,
      });
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

  const setReviewPeriod = (next: ReviewPeriod) => {
    const range = dateRangeForPeriod(next);
    resetPage(() => {
      setPeriod(next);
      setDateFrom(range.from);
      setDateTo(range.to);
    });
  };

  const setReviewDate = (field: "from" | "to", value: string) => {
    resetPage(() => {
      if (field === "from") setDateFrom(value);
      else setDateTo(value);
      setPeriod("all");
    });
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
    <div className="reviews-page">
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

      <StatCardGroup>
        <StatCard label="Recebidas" value={loading ? "—" : stats.total} icon={<MessageSquare size={16} />} />
        <StatCard label="Pendentes" value={loading ? "—" : stats.pending} icon={<Clock3 size={16} />} accent="var(--color-warning)" />
        <StatCard label="Publicadas" value={loading ? "—" : stats.approved} icon={<CheckCircle2 size={16} />} accent="var(--color-success)" />
        <StatCard label="Rejeitadas" value={loading ? "—" : stats.rejected} icon={<XCircle size={16} />} accent="var(--color-error)" />
      </StatCardGroup>

      <section className="panel reviews-filter-panel" aria-label="Filtros de avaliações">
        <div className="reviews-filter-panel__toolbar">
          <div className="period-filter__presets reviews-filter-panel__kind" aria-label="Tipo de avaliação">
            <button
              type="button"
              aria-pressed={kind === "testimonial"}
              onClick={() => resetPage(() => setKind("testimonial"))}
            >
              Avaliações escritas
            </button>
            <button
              type="button"
              aria-pressed={kind === "video"}
              onClick={() => resetPage(() => setKind("video"))}
            >
              Vídeos
            </button>
          </div>
          <div className="reviews-filter-panel__controls">
            <FilterSelect
              ariaLabel="Status da moderação"
              width={150}
              size="md"
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
              ariaLabel="Produto"
              width={210}
              size="md"
              value={productId}
              onChange={(next) => resetPage(() => setProductId(next))}
              options={currentProducts.map((product) => ({ value: product.id, label: product.name }))}
              placeholder={productsLoading ? "Carregando produtos..." : "Todos os produtos"}
            />
          </div>
        </div>
        <PeriodFilter
          presets={PERIOD_PRESETS}
          active={period}
          onPreset={(next) => setReviewPeriod(next as ReviewPeriod)}
          from={dateFrom}
          to={dateTo}
          onDate={setReviewDate}
        />
      </section>

      <section className="panel reviews-list" aria-busy={loading}>
        <div className="reviews-list__header">
          <SectionHeader
            variant="secondary"
            title={kind === "video" ? "Vídeos enviados por clientes" : "Avaliações enviadas por clientes"}
            trailing={<span className="reviews-list__count">{loading ? "Carregando…" : `${reviews.total} resultado${reviews.total === 1 ? "" : "s"}`}</span>}
          />
        </div>

        {loading ? <div className="reviews-list__loading"><PageLoader /></div> : reviews.items.length === 0 ? (
          <div className="reviews-list__empty">
            <EmptyState
              icon={kind === "video" ? FileVideo : MessageSquare}
              title={status === "pending" ? "Nenhuma avaliação pendente" : "Nenhuma avaliação encontrada"}
              description={status === "pending"
                ? "Quando um cliente enviar uma avaliação, ela aparecerá aqui para sua decisão."
                : "Ajuste os filtros para consultar outras avaliações."}
            />
          </div>
        ) : (
          <div className="reviews-list__table">
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
          </div>
        )}

        {!loading && reviews.total > reviews.pageSize ? (
          <Pagination
            page={reviews.page}
            pageSize={reviews.pageSize}
            total={reviews.total}
            onChange={setPage}
          />
        ) : null}
      </section>

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

function dateRangeForPeriod(period: ReviewPeriod): { from: string; to: string } {
  if (period === "all") return { from: "", to: "" };
  const end = new Date();
  const start = new Date(end);
  if (period === "7d") start.setDate(start.getDate() - 6);
  if (period === "15d") start.setDate(start.getDate() - 14);
  if (period === "30d") start.setDate(start.getDate() - 29);
  return { from: toDateInput(start), to: toDateInput(end) };
}

function toDateInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
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
