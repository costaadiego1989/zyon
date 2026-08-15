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
  return (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcTrend(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function CheckoutMetrics({ overview, previousOverview, timeseries }: CheckoutMetricsProps) {
  const prev = previousOverview;
  const funnelSteps = [
    { label: "Sessões", value: overview.conversations_started, color: "var(--accent)" },
    { label: "Ofertas vistas", value: overview.offers_viewed, color: "var(--color-info, #6ea8ff)" },
    { label: "Ofertas aceitas", value: overview.offers_accepted, color: "var(--warn)" },
    { label: "Pedidos", value: overview.orders_completed, color: "var(--good)" },
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Checkout Inteligente
        </h3>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          Performance do agente de vendas e funil de conversão
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        <StatCard
          label="Conversas"
          value={overview.conversations_started}
          trend={calcTrend(overview.conversations_started, prev?.conversations_started)}
        />
        <StatCard
          label="Taxa de Conversão"
          value={`${((overview.conversion_rate_with_agent ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--good)"
          trend={calcTrend((overview.conversion_rate_with_agent ?? 0) * 100, prev?.conversion_rate_with_agent ? prev.conversion_rate_with_agent * 100 : undefined)}
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
        />
        <StatCard
          label="Desconto Médio"
          value={`${((overview.average_discount ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--warn)"
          trend={calcTrend((overview.average_discount ?? 0) * 100, prev?.average_discount ? prev.average_discount * 100 : undefined)}
        />
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }} />

      <ConversionFunnel steps={funnelSteps} />

      {timeseries?.conversion_daily && timeseries.conversion_daily.length > 0 && (
        <RevenueChart
          data={timeseries.conversion_daily}
          type="line"
          label="Conversão diária"
          color="var(--accent)"
          valueFormat="percent"
        />
      )}

      {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 && (
        <RevenueChart
          data={timeseries.revenue_daily}
          type="bar"
          label="Receita diária do checkout"
          color="var(--accent)"
          valueFormat="currency"
        />
      )}
    </section>
  );
}
