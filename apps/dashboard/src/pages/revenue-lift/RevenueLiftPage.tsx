import { Button } from "../../components/Button.js";
import "./revenue-lift.css";
import { PageHeader } from "../../components/PageHeader.js";
import React, { useState } from "react";
import { TrendingUp, DollarSign, Zap, BarChart3 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { useRevenueLiftPage } from "./useRevenueLiftPage.js";

export interface RevenueLiftPageProps {
  apiBaseUrl: string;
  me: MerchantProfile;
}

const FEATURE_LABELS: Record<string, string> = {
  negotiation: "Negociação inteligente",
  cross_sell: "Produtos complementares",
  progressive_discount: "Desconto progressivo",
  cart_recovery: "Recuperação de carrinho",
  intent_personalization: "Personalização por intenção",
  baseline: "Sem assistente IA",
};

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

const PAGE_SIZE = 7;

export function RevenueLiftPage({ me }: RevenueLiftPageProps) {
  const vm = useRevenueLiftPage();
  const [trendPage, setTrendPage] = useState(0);

  const trendData = vm.trend?.trend ?? [];
  const trendTotal = trendData.length;
  const trendPages = Math.max(1, Math.ceil(trendTotal / PAGE_SIZE));
  const currentTrendPage = Math.min(trendPage, trendPages - 1);
  const trendSlice = trendData.slice(currentTrendPage * PAGE_SIZE, (currentTrendPage + 1) * PAGE_SIZE);
  const dataQuality = vm.summary?.dataQuality ?? {
    status: "insufficient_data" as const,
    minimumCohortSessions: 30,
    sources: {
      checkoutSessions: "partial" as const,
      completedOrders: "partial" as const,
      attributionTags: "partial" as const,
    },
    missingMetrics: ["measurement_contract"],
  };
  const missingMetricLabels: Record<string, string> = {
    holdout_session_sample: "amostra do grupo de controle",
    treatment_session_sample: "amostra do grupo com IA",
    holdout_revenue_baseline: "receita aprovada no grupo de controle",
    measurement_contract: "contrato de medição atualizado",
  };

  return (
    <div className="page-container revenue-lift-page">
      <PageHeader title="Impacto na receita" description="Compare os resultados das sessões com e sem IA no período selecionado." actions={<>
<div style={{ display: "flex", gap: 8 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={`fnl-period-btn${vm.periodDays === d ? " active" : ""}`}
              aria-pressed={vm.periodDays === d}
              onClick={() => { vm.setPeriodDays(d); setTrendPage(0); }}
            >
              {d} dias
            </button>
          ))}
        </div>
</>} />

      <details className="revenue-lift-method"><summary>Como interpretar esta comparação</summary><p>Comparamos a receita aprovada por sessão entre os grupos com e sem IA. O resultado pode ser positivo, negativo ou inconclusivo. A leitura depende da amostra e da qualidade dos dados disponíveis.</p><p>Receita associada a um recurso não comprova, isoladamente, que ele causou a diferença observada.</p></details>

      {vm.loading ? (
        <PageLoader />
      ) : vm.error ? (<EmptyState title="Resultados indisponíveis" description={vm.error} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} />) : !vm.summary ? (
        <EmptyState
          icon={BarChart3}
          title="Sem dados ainda"
          description="A comparação aparecerá quando houver dados suficientes nos grupos com e sem IA."
        />
      ) : (
        <>
          {dataQuality.status !== "ready" && (
            <div role="status" style={{
              marginBottom: 14,
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              background: "var(--color-warning-bg)",
              border: "1px solid var(--color-warning-border)",
              color: "var(--color-warning)",
              font: "13px var(--font-sans)",
            }}>
              Dados insuficientes para calcular impacto.{dataQuality.missingMetrics.length > 0 && <> Ainda faltam {dataQuality.missingMetrics.map((metric) => missingMetricLabels[metric] ?? "dados de medição").join(", ")}.</>} São necessárias ao menos {dataQuality.minimumCohortSessions} sessões em cada grupo.
            </div>
          )}
          {/* KPIs */}
          <div className="grid-4" style={{ gap: 14 }}>
            <StatCard
              label="Ganho"
              value={vm.summary.lift.grossLiftPercent != null ? `${vm.summary.lift.grossLiftPercent > 0 ? "+" : ""}${vm.summary.lift.grossLiftPercent.toFixed(1)}%` : "—"}
              icon={<TrendingUp size={16} />}
              accent={vm.summary.lift.grossLiftPercent != null && vm.summary.lift.grossLiftPercent > 0 ? "var(--color-success)" : "var(--color-error)"}
            />
            <StatCard
              label="Receita Extra"
              value={vm.summary.lift.netLiftCents != null ? formatBRL(vm.summary.lift.netLiftCents) : "—"}
              icon={<DollarSign size={16} />}
              accent="var(--color-brand)"
            />
            <StatCard
              label="Retorno"
              value={vm.summary.lift.roiPercent != null ? `${vm.summary.lift.roiPercent.toFixed(0)}×` : "—"}
              icon={<Zap size={16} />}
              accent="var(--color-brand)"
            />
            <StatCard
              label="Custo IA"
              value={formatBRL(vm.summary.aiCostCents)}
              icon={<DollarSign size={16} />}
            />
          </div>

          {/* Comparação */}
          <div className="grid-2" style={{ gap: 14 }}>
            <div className="panel" style={{ padding: "20px 24px" }}>
              <SectionHeader variant="secondary" title="Sessões com IA" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text-faint)", textTransform: "none", letterSpacing: "normal" }}>Sessões</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text)", marginTop: 4 }}>{vm.summary.treatment.sessions.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text-faint)", textTransform: "none", letterSpacing: "normal" }}>Receita</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-brand)", marginTop: 4 }}>{formatBRL(vm.summary.treatment.revenueCents)}</div>
                </div>
              </div>
            </div>
            <div className="panel" style={{ padding: "20px 24px" }}>
              <SectionHeader variant="secondary" title="Sessões sem IA" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text-faint)", textTransform: "none", letterSpacing: "normal" }}>Sessões</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text)", marginTop: 4 }}>{vm.summary.holdout.sessions.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text-faint)", textTransform: "none", letterSpacing: "normal" }}>Receita</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text-muted)", marginTop: 4 }}>{formatBRL(vm.summary.holdout.revenueCents)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Contribuição por recurso */}
          {dataQuality.sources?.attributionTags === "measured" && vm.summary.featureBreakout.length > 0 && (
            <div className="panel" style={{ padding: "20px 24px" }}>
              <SectionHeader variant="secondary" title="Receita associada aos recursos" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {vm.summary.featureBreakout.map((f) => {
                  const maxRevenue = Math.max(...vm.summary!.featureBreakout.map((x) => x.revenueCents), 1);
                  const pct = (f.revenueCents / maxRevenue) * 100;
                  return (
                    <div key={f.feature} className="revenue-lift-feature">
                      <span style={{ font: "500 12px var(--font-sans)", color: "var(--color-text)", minWidth: 180 }}>
                        {FEATURE_LABELS[f.feature] ?? f.feature}
                      </span>
                      <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-brand)", borderRadius: 4 }} />
                      </div>
                      <span style={{ font: "600 11px var(--font-data)", color: "var(--color-text-muted)", minWidth: 80, textAlign: "right" }}>
                        {formatBRL(f.revenueCents)}
                      </span>
                      <span style={{ font: "500 11px var(--font-data)", color: "var(--color-text-faint)", minWidth: 60, textAlign: "right" }}>
                        {f.orders} pedidos
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {vm.trendError && <EmptyState title="Evolução indisponível" description={vm.trendError} action={<Button variant="outline" onClick={vm.refresh}>Tentar novamente</Button>} />}
          {/* Evolução diária */}
          {dataQuality.status === "ready" && trendTotal > 0 && (
            <DataPanel
              title="Evolução diária"
              page={currentTrendPage + 1}
              pageSize={PAGE_SIZE}
              total={trendTotal}
              onPageChange={(p) => setTrendPage(p - 1)}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                      <th style={{ textAlign: "left", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Ganho</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Com IA</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Sem IA</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 13px var(--font-sans)", letterSpacing: "normal", color: "var(--color-text-faint)", textTransform: "none", borderBottom: "1px solid var(--color-border)" }}>Sessões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendSlice.map((d, i) => (
                      <tr key={d.date} style={{ borderBottom: i < trendSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                        <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>
                          {new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })}
                        </td>
                        <td style={{ padding: "12px 20px" }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-full)",
                            font: "600 11px var(--font-data)",
                            background: d.liftPercent == null || d.liftPercent === 0 ? "var(--surface-2)" : d.liftPercent > 0 ? "var(--color-success-bg)" : "var(--color-error-bg)",
                            color: d.liftPercent == null || d.liftPercent === 0 ? "var(--color-text-muted)" : d.liftPercent > 0 ? "var(--color-success)" : "var(--color-error)",
                          }}>
                            {d.liftPercent != null ? `${d.liftPercent > 0 ? "+" : ""}${d.liftPercent.toFixed(1)}%` : "—"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px", font: "600 13px var(--font-data)", color: "var(--color-brand)", textAlign: "right" }}>
                          {formatBRL(d.treatmentRevenueCents)}
                        </td>
                        <td style={{ padding: "12px 20px", font: "13px var(--font-data)", color: "var(--color-text-muted)", textAlign: "right" }}>
                          {formatBRL(d.holdoutRevenueCents)}
                        </td>
                        <td style={{ padding: "12px 20px", font: "12px var(--font-data)", color: "var(--color-text-faint)", textAlign: "right" }}>
                          {d.treatmentSessions + d.holdoutSessions}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DataPanel>
          )}
        </>
      )}
    </div>
  );
}
