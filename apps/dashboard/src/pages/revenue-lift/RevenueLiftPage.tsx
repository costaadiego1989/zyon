import React from "react";
import { TrendingUp, Users, DollarSign, Zap, BarChart3 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { useRevenueLiftPage } from "./useRevenueLiftPage.js";

export interface RevenueLiftPageProps {
  apiBaseUrl: string;
  me: MerchantProfile;
}

const FEATURE_LABELS: Record<string, string> = {
  negotiation: "Negociação M2M",
  cross_sell: "Cross-sell",
  progressive_discount: "Desconto Progressivo",
  cart_recovery: "Cart Recovery",
  intent_personalization: "Intent Memory",
  baseline: "Baseline (sem IA)",
};

function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function RevenueLiftPage({ me }: RevenueLiftPageProps) {
  const vm = useRevenueLiftPage();

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Revenue Lift</h1>
          <p className="page-lead">
            Mede o impacto real da IA nas suas vendas comparando grupo de tratamento (95% dos compradores com IA ativa) vs grupo holdout (5% sem IA).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={`fnl-period-btn${vm.periodDays === d ? " active" : ""}`}
              onClick={() => vm.setPeriodDays(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {vm.loading ? (
        <PageLoader />
      ) : !vm.summary ? (
        <EmptyState
          icon={BarChart3}
          title="Sem dados de Revenue Lift"
          description="Revenue Lift é calculado automaticamente a partir dos pedidos. Quando houver vendas suficientes, os dados aparecerão aqui."
        />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid-4" style={{ gap: 14 }}>
            <StatCard
              label="Lift"
              value={vm.summary.lift.grossLiftPercent != null ? `${vm.summary.lift.grossLiftPercent.toFixed(1)}%` : "—"}
              icon={<TrendingUp size={16} />}
              accent={vm.summary.lift.grossLiftPercent != null && vm.summary.lift.grossLiftPercent > 0 ? "var(--color-success)" : "var(--color-error)"}
            />
            <StatCard
              label="Receita Incremental"
              value={vm.summary.lift.netLiftCents != null ? formatBRL(vm.summary.lift.netLiftCents) : "—"}
              icon={<DollarSign size={16} />}
              accent="var(--color-brand)"
            />
            <StatCard
              label="ROI da IA"
              value={vm.summary.lift.roiPercent != null ? `${vm.summary.lift.roiPercent.toFixed(0)}%` : "—"}
              icon={<Zap size={16} />}
              accent="var(--color-brand)"
            />
            <StatCard
              label="Custo IA"
              value={formatBRL(vm.summary.aiCostCents)}
              icon={<DollarSign size={16} />}
            />
          </div>

          {/* Cohort Comparison */}
          <div className="grid-2" style={{ gap: 14 }}>
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="Tratamento (95%)" />
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
              <SectionHeader variant="secondary" title="Holdout (5%)" />
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

          {/* Feature Breakout */}
          {vm.summary.featureBreakout.length > 0 && (
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="Contribuição por Feature" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {vm.summary.featureBreakout.map((f) => {
                  const maxRevenue = Math.max(...vm.summary!.featureBreakout.map((x) => x.revenueCents), 1);
                  const pct = (f.revenueCents / maxRevenue) * 100;
                  return (
                    <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ font: "500 12px var(--font-sans)", color: "var(--color-text)", minWidth: 160 }}>
                        {FEATURE_LABELS[f.feature] ?? f.feature}
                      </span>
                      <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-brand)", borderRadius: 4 }} />
                      </div>
                      <span style={{ font: "600 11px var(--font-data)", color: "var(--color-text-muted)", minWidth: 80, textAlign: "right" }}>
                        {formatBRL(f.revenueCents)}
                      </span>
                      <span style={{ font: "500 11px var(--font-data)", color: "var(--color-text-faint)", minWidth: 50, textAlign: "right" }}>
                        {f.orders} ped.
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trend */}
          {vm.trend && vm.trend.trend.length > 0 && (
            <div className="panel" style={{ padding: "18px 20px" }}>
              <SectionHeader variant="secondary" title="Tendência Diária" />
              <div style={{ overflowX: "auto" }}>
                <table className="fnl-sessions-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Lift</th>
                      <th>Tratamento</th>
                      <th>Holdout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.trend.trend.slice(-14).map((d) => (
                      <tr key={d.date}>
                        <td style={{ font: "12px var(--font-data)" }}>{new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                        <td style={{ font: "600 12px var(--font-data)", color: d.liftPercent != null && d.liftPercent > 0 ? "var(--color-success)" : "var(--color-error)" }}>
                          {d.liftPercent != null ? `${d.liftPercent.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ font: "12px var(--font-data)", color: "var(--color-brand)" }}>{formatBRL(d.treatmentRevenueCents)}</td>
                        <td style={{ font: "12px var(--font-data)", color: "var(--color-text-muted)" }}>{formatBRL(d.holdoutRevenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
