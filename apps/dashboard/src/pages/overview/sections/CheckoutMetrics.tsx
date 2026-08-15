import React from "react";
import type { DashboardOverview, TimeseriesResponse } from "@zyon/shared-types";
import { StatCard } from "../components/StatCard.js";
import { ConversionFunnel } from "../components/ConversionFunnel.js";
import { RevenueChart } from "../components/RevenueChart.js";

export type CheckoutMetricsProps = {
  overview: DashboardOverview;
  previousOverview: DashboardOverview | null;
  timeseries: TimeseriesResponse | null;
};

function formatCurrency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function calcTrend(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function CheckoutMetrics({
  overview,
  previousOverview,
  timeseries,
}: CheckoutMetricsProps) {
  const prev = previousOverview;

  const funnelSteps = [
    { label: "Sessoes", value: overview.conversations_started, color: "var(--accent)" },
    { label: "Ofertas vistas", value: overview.offers_viewed, color: "oklch(70% 0.14 250)" },
    { label: "Ofertas aceitas", value: overview.offers_accepted, color: "var(--warn)" },
    { label: "Pedidos", value: overview.orders_completed, color: "var(--good)" },
  ];

  const convSparkline = timeseries?.conversion_daily?.map((d) => d.value) ?? [];
  const revSparkline = timeseries?.revenue_daily?.map((d) => d.value) ?? [];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero metric cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard
          label="Conversas"
          value={overview.conversations_started}
          trend={calcTrend(overview.conversations_started, prev?.conversations_started)}
          sparkline={timeseries?.sessions_daily?.map((d) => d.value)}
        />
        <StatCard
          label="Taxa de Conversao"
          value={`${((overview.conversion_rate_with_agent ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--good)"
          trend={calcTrend(
            (overview.conversion_rate_with_agent ?? 0) * 100,
            prev?.conversion_rate_with_agent
              ? prev.conversion_rate_with_agent * 100
              : undefined,
          )}
          sparkline={convSparkline}
        />
        <StatCard
          label="Ofertas"
          value={`${overview.offers_accepted ?? 0}/${overview.offers_viewed ?? 0}`}
          trend={calcTrend(overview.offers_accepted ?? 0, prev?.offers_accepted)}
        />
        <StatCard
          label="Receita Incremental"
          value={formatCurrency(overview.incremental_revenue)}
          prefix="R$"
          accent="var(--accent)"
          trend={calcTrend(overview.incremental_revenue, prev?.incremental_revenue)}
          sparkline={revSparkline}
        />
        <StatCard
          label="Desconto Medio"
          value={`${((overview.average_discount ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--warn)"
          trend={calcTrend(
            (overview.average_discount ?? 0) * 100,
            prev?.average_discount ? prev.average_discount * 100 : undefined,
          )}
        />
      </div>

      {/* Bento grid: 2/3 chart + 1/3 funnel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
        }}
      >
        {timeseries?.conversion_daily && timeseries.conversion_daily.length > 0 ? (
          <RevenueChart
            data={timeseries.conversion_daily}
            type="line"
            label="Conversao diaria"
            color="var(--accent)"
            valueFormat="percent"
          />
        ) : (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            Sem dados de conversao
          </div>
        )}

        <ConversionFunnel steps={funnelSteps} title="Funil de Conversao" />
      </div>

      {/* Full-width revenue chart */}
      {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 && (
        <RevenueChart
          data={timeseries.revenue_daily}
          type="bar"
          label="Receita diaria do checkout"
          color="var(--accent)"
          valueFormat="currency"
        />
      )}
    </section>
  );
}
