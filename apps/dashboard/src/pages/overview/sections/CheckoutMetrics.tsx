import React from "react";
import type { DashboardOverview, TimeseriesResponse } from "@zyon/shared-types";
import { MessageSquare, Percent, Gift, DollarSign } from "lucide-react";
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

function calcTrend(current: number, previous: number | null | undefined): number {
  if (previous === undefined || previous === null || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export function CheckoutMetrics({
  overview,
  previousOverview,
  timeseries,
}: CheckoutMetricsProps) {
  const prev = previousOverview;

  const convSparkline = timeseries?.conversion_daily?.map((d) => d.value) ?? [];
  const revSparkline = timeseries?.revenue_daily?.map((d) => d.value) ?? [];
  const sessionsSparkline = timeseries?.sessions_daily?.map((d) => d.value) ?? [];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero metric cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Conversas"
          value={overview.conversations_started}
          trend={calcTrend(overview.conversations_started, prev?.conversations_started)}
          sparkline={sessionsSparkline}
          icon={<MessageSquare size={16} />}
        />
        <StatCard
          label="Taxa de Conversao"
          value={`${((overview.conversion_rate_with_agent ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--color-success)"
          trend={calcTrend(
            (overview.conversion_rate_with_agent ?? 0) * 100,
            prev?.conversion_rate_with_agent
              ? prev.conversion_rate_with_agent * 100
              : undefined,
          )}
          sparkline={convSparkline}
          icon={<Percent size={16} />}
        />
        <StatCard
          label="Ofertas"
          value={`${overview.offers_accepted ?? 0}/${overview.offers_viewed ?? 0}`}
          trend={calcTrend(overview.offers_accepted ?? 0, prev?.offers_accepted)}
          sparkline={convSparkline}
          icon={<Gift size={16} />}
        />
        <StatCard
          label="Receita Incremental"
          value={formatCurrency(overview.incremental_revenue)}
          prefix="R$"
          accent="var(--color-brand)"
          trend={calcTrend(overview.incremental_revenue, prev?.incremental_revenue)}
          sparkline={revSparkline}
          icon={<DollarSign size={16} />}
        />
      </div>

      {/* Bento grid: 2/3 charts stacked + 1/3 funnel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {timeseries?.conversion_daily && timeseries.conversion_daily.length > 0 ? (
            <RevenueChart
              data={timeseries.conversion_daily}
              type="line"
              label="Conversao diária"
              color="var(--color-brand)"
              valueFormat="percent"
            />
          ) : (
            <div
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 14,
                padding: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-text-muted)",
                fontSize: 13,
              }}
            >
              Sem dados de conversao
            </div>
          )}

          {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 && (
            <RevenueChart
              data={timeseries.revenue_daily}
              type="bar"
              label="Receita diária"
              color="var(--color-brand)"
              valueFormat="currency"
            />
          )}
        </div>

        <ConversionFunnel steps={[
          { label: "Sessões", value: overview.conversations_started ?? 0, color: "var(--color-brand)" },
          { label: "Ofertas vistas", value: overview.offers_viewed ?? 0, color: "oklch(70% 0.14 250)" },
          { label: "Ofertas aceitas", value: overview.offers_accepted ?? 0, color: "var(--color-warning)" },
          { label: "Pedidos", value: overview.orders_completed ?? 0, color: "var(--color-success)" },
        ]} title="Funil de Conversao" />
      </div>
    </section>
  );
}
