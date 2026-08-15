import React from "react";
import type { StoreOverview, TimeseriesResponse } from "@zyon/shared-types";
import { StatCard } from "../components/StatCard.js";
import { OrderStatusDonut } from "../components/OrderStatusDonut.js";
import { TopProducts } from "../components/TopProducts.js";
import { RevenueChart } from "../components/RevenueChart.js";

export type StoreMetricsProps = {
  overview: StoreOverview;
  previousOverview: StoreOverview | null;
  timeseries: TimeseriesResponse | null;
};

function formatCurrency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcTrend(current: number, previous: number | undefined): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function StoreMetrics({ overview, previousOverview, timeseries }: StoreMetricsProps) {
  const prev = previousOverview;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
        Loja
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        <StatCard
          label="Receita"
          value={formatCurrency(overview.revenue)}
          prefix="R$"
          accent="var(--accent)"
          trend={calcTrend(overview.revenue, prev?.revenue)}
        />
        <StatCard
          label="Pedidos"
          value={overview.orders_count}
          trend={calcTrend(overview.orders_count, prev?.orders_count)}
        />
        <StatCard
          label="Ticket Médio"
          value={formatCurrency(overview.average_ticket)}
          prefix="R$"
          trend={calcTrend(overview.average_ticket, prev?.average_ticket)}
        />
        <StatCard
          label="Produtos Vendidos"
          value={overview.products_sold}
          trend={calcTrend(overview.products_sold, prev?.products_sold)}
        />
        <StatCard
          label="Novos Clientes"
          value={overview.new_customers}
          accent="var(--good)"
          trend={calcTrend(overview.new_customers, prev?.new_customers)}
        />
        <StatCard
          label="Abandono"
          value={`${((overview.abandonment_rate ?? 0) * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--danger)"
          trend={calcTrend((overview.abandonment_rate ?? 0) * 100, prev?.abandonment_rate ? prev.abandonment_rate * 100 : undefined)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {overview.orders_by_status && <OrderStatusDonut data={overview.orders_by_status} />}
        {overview.top_products && <TopProducts products={overview.top_products} />}
      </div>

      {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 && (
        <RevenueChart
          data={timeseries.revenue_daily}
          type="bar"
          label="Receita diária"
          color="var(--accent)"
          valueFormat="currency"
        />
      )}
    </section>
  );
}
