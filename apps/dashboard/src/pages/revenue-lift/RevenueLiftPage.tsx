import React, { useState } from "react";
import { TrendingUp, DollarSign, Zap, BarChart3 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { Pagination } from "../../components/Pagination.js";
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
  const trendSlice = trendData.slice(trendPage * PAGE_SIZE, (trendPage + 1) * PAGE_SIZE);

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Ganho de Receita</h1>
          <p className="page-lead">
            Quanto a mais você está vendendo com a IA ativa em comparação com vendas sem IA
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={`fnl-period-btn${vm.periodDays === d ? " active" : ""}`}
              onClick={() => { vm.setPeriodDays(d); setTrendPage(0); }}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {/* Explicação do cálculo */}
      <div className="panel" style={{ padding: "14px 20px", background: "color-mix(in srgb, var(--color-brand) 4%, var(--surface-2))", border: "1px solid color-mix(in srgb, var(--color-brand) 20%, var(--color-border))" }}>
        <p style={{ font: "13px/1.6 var(--font-sans)", color: "var(--color-text-muted)", margin: 0 }}>
          <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong> 5% dos compradores passam pelo checkout sem o assistente IA (grupo de controle).
          Os outros 95% usam todos os recursos IA. Comparamos a receita média por sessão entre os dois grupos para calcular
          quanto a mais a IA está gerando. O ganho é real — medido a partir dos pedidos pagos, não estimativas.
        </p>
      </div>

      {vm.loading ? (
        <PageLoader />
      ) : !vm.summary ? (
        <EmptyState
          icon={BarChart3}
          title="Sem dados ainda"
          description="O ganho de receita é calculado automaticamente quando houver pedidos suficientes. Continue vendendo e os dados aparecerão aqui."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid-4" style={{ gap: 14 }}>
            <StatCard
              label="Ganho"
              value={vm.summary.lift.grossLiftPercent != null ? `+${vm.summary.lift.grossLiftPercent.toFixed(1)}%` : "—"}
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
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="Com IA (95% dos compradores)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Sessões</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text)", marginTop: 4 }}>{vm.summary.treatment.sessions.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Receita</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-brand)", marginTop: 4 }}>{formatBRL(vm.summary.treatment.revenueCents)}</div>
                </div>
              </div>
            </div>
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="Sem IA (5% controle)" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Sessões</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text)", marginTop: 4 }}>{vm.summary.holdout.sessions.toLocaleString("pt-BR")}</div>
                </div>
                <div>
                  <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Receita</div>
                  <div style={{ font: "700 20px var(--font-data)", color: "var(--color-text-muted)", marginTop: 4 }}>{formatBRL(vm.summary.holdout.revenueCents)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Contribuição por recurso */}
          {vm.summary.featureBreakout.length > 0 && (
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="O que mais contribuiu" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {vm.summary.featureBreakout.map((f) => {
                  const maxRevenue = Math.max(...vm.summary!.featureBreakout.map((x) => x.revenueCents), 1);
                  const pct = (f.revenueCents / maxRevenue) * 100;
                  return (
                    <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

          {/* Evolução diária */}
          {trendTotal > 0 && (
            <div className="panel" style={{ overflow: "hidden" }}>
              <div style={{ padding: "18px 20px 0" }}>
                <SectionHeader variant="secondary" title="Evolução diária" />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                      <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Ganho</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Com IA</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Sem IA</th>
                      <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Sessões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendSlice.map((d, i) => (
                      <tr key={d.date} style={{ borderBottom: i < trendSlice.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                        <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>
                          {new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                        </td>
                        <td style={{ padding: "12px 20px" }}>
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "var(--radius-full)",
                            font: "600 11px var(--font-data)",
                            background: d.liftPercent != null && d.liftPercent > 0 ? "var(--color-success-bg)" : "var(--color-error-bg)",
                            color: d.liftPercent != null && d.liftPercent > 0 ? "var(--color-success)" : "var(--color-error)",
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

              {/* Paginação */}
              {trendTotal > PAGE_SIZE && (
                <Pagination
                  page={trendPage + 1}
                  pageSize={PAGE_SIZE}
                  total={trendTotal}
                  onChange={(p) => setTrendPage(p - 1)}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
