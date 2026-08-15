import React from "react";
import type { StoreOverview, TimeseriesResponse } from "@zyon/shared-types";
import { StatCard } from "../components/StatCard.js";
import { OrderStatusDonut } from "../components/OrderStatusDonut.js";
import { TopProducts } from "../components/TopProducts.js";
import { RevenueChart } from "../components/RevenueChart.js";

export type StoreMetricsProps = {
  overview: StoreOverview;
  timeseries: TimeseriesResponse | null;
};

function formatCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StoreMetrics({ overview, timeseries }: StoreMetricsProps) {
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
        />
        <StatCard
          label="Pedidos"
          value={overview.orders_count}
        />
        <StatCard
          label="Ticket Médio"
          value={formatCurrency(overview.average_ticket)}
          prefix="R$"
        />
        <StatCard
          label="Produtos Vendidos"
          value={overview.products_sold}
        />
        <StatCard
          label="Novos Clientes"
          value={overview.new_customers}
          accent="var(--good)"
        />
        <StatCard
          label="Abandono"
          value={`${(overview.abandonment_rate * 100).toFixed(1)}`}
          suffix="%"
          accent="var(--danger)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <OrderStatusDonut data={overview.orders_by_status} />
        <TopProducts products={overview.top_products} />
      </div>

      {timeseries?.revenue_daily && timeseries.revenue_daily.length > 0 && (
        <RevenueChart
          data={timeseries.revenue_daily}
          type="bar"
          label="Receita diária"
          color="var(--accent)"
        />
      )}
    </section>
  );
}
