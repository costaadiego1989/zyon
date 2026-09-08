import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck, Video, Star, MessageSquare, CheckCircle2, XCircle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { dashboardJson } from "../../api/http/client.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Button } from "../../components/Button.js";
import { showToast } from "../../components/Toast.js";

/**
 * ModerationPage — Wave 3
 *
 * Merchant dashboard surface for the Advanced Product Layout moderation
 * queue. Renders pending buyer-submitted testimonials and videos for a
 * single product and lets the merchant approve or reject them in one click.
 *
 * Wire-up notes:
 *  - Routes as `/moderation/:productId` (added separately in the dashboard
 *    shell — this file is the page component only).
 *  - Reads from `GET /merchants/:mid/products/:pid/moderation/pending` and
 *    POSTs to `/merchants/:mid/products/:pid/{testimonials|videos}/:id/moderate`.
 *  - Matches the dashboard styling tokens (SectionHeader, EmptyState, brand
 *    color via CSS variables) so it slots into the existing shell.
 */
export interface ModerationPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  productId: string | null;
  onBack?: () => void;
}

interface PendingTestimonial {
  id: string;
  productId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  body: string;
  rating?: number | null;
  source: "curated" | "customer_submission";
  buyerId?: string | null;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface PendingVideo {
  id: string;
  productId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  source: "merchant" | "customer";
  buyerId?: string | null;
  moderationStatus: "pending" | "approved" | "rejected";
  createdAt: string;
}

interface PendingResponse {
  pendingTestimonials: PendingTestimonial[];
  pendingVideos: PendingVideo[];
}

export function ModerationPage(props: ModerationPageProps) {
  const apiBaseUrl = props.apiBaseUrl;
  const [data, setData] = useState<PendingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const merchantId = props.me?.id ?? null;

  const load = useCallback(async () => {
    if (!merchantId || !props.productId) return;
    setLoading(true);
    setError(null);
    try {
      // Endpoint mirrors the Wave 3 moderation controller
      // POST .../merchants/:mid/products/:pid/moderation/pending. We use POST
      // (not GET) to stay consistent with the rest of the merchant
      // dashboard surface and to keep payload shape forward-compatible.
      const out = await dashboardJson<PendingResponse>(
        apiBaseUrl,
        `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(props.productId)}/moderation/pending`,
        { method: "POST", jsonBody: {} }
      );
      setData(out);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao carregar fila";
      setError(message);
      showToast("error", message);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, merchantId, props.productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = useCallback(
    async (
      kind: "testimonial" | "video",
      id: string,
      moderationStatus: "approved" | "rejected"
    ) => {
      if (!merchantId || !props.productId) return;
      setBusyId(id);
      try {
        await dashboardJson(
          apiBaseUrl,
          `/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(props.productId)}/${kind}s/${encodeURIComponent(id)}/moderate`,
          { method: "POST", jsonBody: { moderationStatus, isPublished: moderationStatus === "approved" } }
        );
        showToast(
          "success",
          moderationStatus === "approved" ? "Aprovado" : "Rejeitado"
        );
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro ao moderar";
        showToast("error", message);
      } finally {
        setBusyId(null);
      }
    },
    [apiBaseUrl, merchantId, props.productId, load]
  );

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Moderação</span>
          <h1>Login necessário</h1>
        </div>
      </header>
    );
  }

  if (!props.productId) {
    return (
      <div className="page-container">
        <header className="page-head">
          <div>
            <span className="eyebrow">Moderação</span>
            <h1>Produto não informado</h1>
            <p className="page-lead">Abra a moderação a partir da página de um produto.</p>
          </div>
        </header>
      </div>
    );
  }

  const totalPending =
    (data?.pendingTestimonials.length ?? 0) +
    (data?.pendingVideos.length ?? 0);

  return (
    <div className="page-container">
      <header className="page-head">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {props.onBack ? (
            <Button variant="ghost" onClick={props.onBack}>
              <ArrowLeft size={16} /> Voltar
            </Button>
          ) : null}
          <div>
            <span className="eyebrow">Advanced Product Layout</span>
            <h1 style={{ color: "var(--color-brand)" }}>Moderação</h1>
            <p className="page-lead">
              Aprove ou rejeite depoimentos e vídeos enviados pelos compradores.
            </p>
          </div>
        </div>
      </header>

      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader
          icon={<ShieldCheck size={16} />}
          title={`Fila de moderação (${totalPending})`}
          subtitle="Tudo aqui está com moderationStatus=pending e ainda não aparece na loja."
          trailing={
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              Atualizar
            </Button>
          }
        />

        {loading && !data ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)" }}>
            Carregando fila...
          </div>
        ) : null}

        {error ? (
          <EmptyState
            icon={XCircle}
            title="Erro ao carregar fila"
            description={error}
            action={<Button onClick={() => void load()}>Tentar novamente</Button>}
          />
        ) : null}

        {!loading && !error && data && totalPending === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nenhum item pendente"
            description="Quando um comprador enviar um depoimento ou vídeo pela loja, ele aparecerá aqui."
          />
        ) : null}

        {data && data.pendingTestimonials.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            <SectionHeader
              variant="secondary"
              icon={<MessageSquare size={14} />}
              title={`Depoimentos (${data.pendingTestimonials.length})`}
            />
            {data.pendingTestimonials.map((t) => (
              <ModerationRow key={t.id} busy={busyId === t.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ font: "600 13px var(--font-sans)" }}>{t.authorName}</strong>
                    {t.rating ? (
                      <span style={{ color: "var(--color-warning)", display: "inline-flex", gap: 2 }}>
                        {Array.from({ length: t.rating }).map((_, i) => (
                          <Star key={i} size={12} fill="currentColor" />
                        ))}
                      </span>
                    ) : null}
                    <span
                      style={{
                        font: "11px var(--font-sans)",
                        color: "var(--color-text-faint)",
                        padding: "2px 6px",
                        background: "var(--color-warning-bg, rgba(245,158,11,0.12))",
                        borderRadius: 4,
                      }}
                    >
                      pending
                    </span>
                  </div>
                  <p style={{ margin: 0, font: "13px var(--font-sans)", color: "var(--color-text)", lineHeight: 1.5 }}>
                    {t.body}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="outline"
                    onClick={() => void moderate("testimonial", t.id, "rejected")}
                    disabled={busyId === t.id}
                  >
                    Rejeitar
                  </Button>
                  <Button
                    onClick={() => void moderate("testimonial", t.id, "approved")}
                    disabled={busyId === t.id}
                  >
                    Aprovar
                  </Button>
                </div>
              </ModerationRow>
            ))}
          </div>
        ) : null}

        {data && data.pendingVideos.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
            <SectionHeader
              variant="secondary"
              icon={<Video size={14} />}
              title={`Vídeos (${data.pendingVideos.length})`}
            />
            {data.pendingVideos.map((v) => (
              <ModerationRow key={v.id} busy={busyId === v.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ font: "600 13px var(--font-sans)" }}>{v.title}</strong>
                    <span
                      style={{
                        font: "11px var(--font-sans)",
                        color: "var(--color-text-faint)",
                        padding: "2px 6px",
                        background: "var(--color-warning-bg, rgba(245,158,11,0.12))",
                        borderRadius: 4,
                      }}
                    >
                      pending
                    </span>
                  </div>
                  <a
                    href={v.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ font: "12px var(--font-sans)", color: "var(--color-brand)", textDecoration: "underline" }}
                  >
                    {v.videoUrl}
                  </a>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="outline"
                    onClick={() => void moderate("video", v.id, "rejected")}
                    disabled={busyId === v.id}
                  >
                    Rejeitar
                  </Button>
                  <Button
                    onClick={() => void moderate("video", v.id, "approved")}
                    disabled={busyId === v.id}
                  >
                    Aprovar
                  </Button>
                </div>
              </ModerationRow>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface RowProps {
  busy: boolean;
  children: React.ReactNode;
}

function ModerationRow({ children }: RowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        padding: "12px 16px",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-surface, rgba(255,255,255,0.02))",
      }}
    >
      {children}
    </div>
  );
}
