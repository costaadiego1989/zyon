import React from "react";
import type { DashboardOverview, TimeseriesResponse } from "@zyon/shared-types";
import { StatCard } from "../components/StatCard.js";
import { ConversionFunnel } from "../components/ConversionFunnel.js";
import { RevenueChart } from "../components/RevenueChart.js";

export type CheckoutMetricsProps = {
  overview: DashboardOverview;
  timeseries: TimeseriesResponse | null;
};

function formatCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CheckoutMetrics({ overview, timeseries }: CheckoutMetricsProps) {
  const funnelSteps = [
    { label: "Sessões", value: overview.conversations_started, color: "var(--accent)" },
    { label: "Ofertas vistas", value: overview.offers_viewed, color: "var(--color-info, #6ea8ff)" },
    { label: "Ofertas aceitas", value: overview.offers_accepted, color: "var(--warn)" },
    { label: "Pedidos", value: overview.orders_completed, color: "var(--good)" },
  ];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
        Checkout Inteligente
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        <StatCard
          label="Conversas"
          value={overview.conversations_started}
        />
        <StatCard
          label="Taxa de Conversão"
          value={`${(overview.conversion_rate_with_agent * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--good)"
        />
        <StatCard
          label="Ofertas"
          value={`${overview.offers_accepted}/${overview.offers_viewed}`}
        />
        <StatCard
          label="Receita Incremental"
          value={formatCurrency(overview.incremental_revenue)}
          prefix="R$"
          accent="var(--accent)"
        />
        <StatCard
          label="Desconto Médio"
          value={`${(overview.average_discount * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--warn)"
        />
      </div>

      <ConversionFunnel steps={funnelSteps} />

      {timeseries?.conversion_daily && timeseries.conversion_daily.length > 0 && (
        <RevenueChart
          data={timeseries.conversion_daily}
          type="line"
          label="Conversão diária"
          color="var(--accent)"
        />
      )}
    </section>
  );
}
