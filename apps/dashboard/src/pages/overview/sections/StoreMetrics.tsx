import React from "react";
import type { StoreOverview, TimeseriesResponse } from "@zyon/shared-types";
import { DollarSign, ShoppingCart, Receipt, TrendingDown } from "lucide-react";
import { StatCard } from "../components/StatCard.js";
import { OrderStatusDonut } from "../components/OrderStatusDonut.js";
import { TopProducts } from "../components/TopProducts.js";
import { RevenueChart } from "../components/RevenueChart.js";
import { ConversionFunnel } from "../components/ConversionFunnel.js";

export type StoreMetricsProps = {
  overview: StoreOverview;
  previousOverview: StoreOverview | null;
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

export function StoreMetrics({
  overview,
  previousOverview,
  timeseries,
}: StoreMetricsProps) {
  const prev = previousOverview;

  const revSparkline = timeseries?.revenue_daily?.map((d) => d.value) ?? [];
  const ordersSparkline = timeseries?.orders_daily?.map((d) => d.value) ?? [];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hero metric cards — max 4 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <StatCard
          label="Receita"
          value={formatCurrency(overview.revenue)}
          prefix="R$"
          accent="var(--accent)"
          trend={calcTrend(overview.revenue, prev?.revenue)}
          sparkline={revSparkline}
          icon={<DollarSign size={16} />}
        />
        <StatCard
          label="Pedidos"
          value={overview.orders_count}
          trend={calcTrend(overview.orders_count, prev?.orders_count)}
          sparkline={ordersSparkline}
          icon={<ShoppingCart size={16} />}
        />
        <StatCard
          label="Ticket Medio"
          value={formatCurrency(overview.average_ticket)}
          prefix="R$"
          trend={calcTrend(overview.average_ticket, prev?.average_ticket)}
          icon={<Receipt size={16} />}
        />
        <StatCard
          label="Abandono"
          value={`${((overview.abandonment_rate ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--danger)"
          trend={calcTrend(
            (overview.abandonment_rate ?? 0) * 100,
            prev?.abandonment_rate ? prev.abandonment_rate * 100 : undefined,
          )}
          icon={<TrendingDown size={16} />}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 ? (
            <RevenueChart
              data={timeseries.revenue_daily}
              type="bar"
              label="Receita diaria"
              color="var(--accent)"
              valueFormat="currency"
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
              Sem dados de receita
            </div>
          )}

          {timeseries?.conversion_daily && timeseries.conversion_daily.length > 0 && (
            <RevenueChart
              data={timeseries.conversion_daily}
              type="line"
              label="Conversao diaria"
              color="var(--accent)"
              valueFormat="percent"
            />
          )}
        </div>

        <ConversionFunnel
          title="Funil de Pedidos"
          steps={[
            { label: "Pedidos", value: overview.orders_count ?? 0, color: "var(--accent)" },
            {
              label: "Aprovados",
              value:
                (overview.orders_by_status?.approved ?? 0) +
                (overview.orders_by_status?.paid ?? 0) +
                (overview.orders_by_status?.shipped ?? 0) +
                (overview.orders_by_status?.delivered ?? 0),
              color: "var(--good)",
            },
            {
              label: "Enviados",
              value:
                (overview.orders_by_status?.shipped ?? 0) +
                (overview.orders_by_status?.delivered ?? 0),
              color: "oklch(70% 0.14 250)",
            },
            {
              label: "Entregues",
              value: overview.orders_by_status?.delivered ?? 0,
              color: "var(--good)",
            },
          ]}
        />
      </div>

      {/* Bento grid: 1/3 donut + 2/3 top products */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: 12,
        }}
      >
        {overview.orders_by_status && <OrderStatusDonut data={overview.orders_by_status} />}
        {overview.top_products && <TopProducts products={overview.top_products} />}
      </div>
    </section>
  );
}
