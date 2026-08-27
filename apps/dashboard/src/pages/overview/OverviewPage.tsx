import React, { useState, useEffect } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useOverviewPage } from "./useOverviewPage.js";
import { PeriodSelector } from "./components/PeriodSelector.js";
import { ActivityFeed, type ActivityItem } from "./components/ActivityFeed.js";
import { StatCard } from "./components/StatCard.js";
import { RevenueChart } from "./components/RevenueChart.js";
import { ConversionFunnel } from "./components/ConversionFunnel.js";
import { OrderStatusDonut } from "./components/OrderStatusDonut.js";
import { TopProducts } from "./components/TopProducts.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SectionErrorBoundary } from "../../components/PageErrorBoundary.js";
import {
  TrendingUp,
  DollarSign,
  Package,
  Percent,
  Receipt,
  Users,
  ShoppingCart,
  TrendingDown,
  BarChart3,
} from "lucide-react";

export type OverviewPageProps = {
  apiBaseUrl: string;
  defaultMerchantId: string;
  me: MerchantProfile;
};

function buildActivityItems(vm: ReturnType<typeof useOverviewPage>): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (vm.checkoutOverview?.recent_sessions) {
    for (const s of (vm.checkoutOverview.recent_sessions ?? []).slice(0, 5)) {
      items.push({
        id: s.sessionId ?? `session-${items.length}`,
        type: "session",
        description: `Sessão iniciada`,
        timestamp: s.createdAt ?? new Date().toISOString(),
      });
    }
  }

  if (vm.storeOverview?.recent_orders) {
    for (const o of (vm.storeOverview.recent_orders ?? []).slice(0, 5)) {
      items.push({
        id: o.id,
        type: "order",
        description: `Pedido de ${o.buyer_name}`,
        timestamp: o.created_at,
        amount: o.total,
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, 10);
}

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            height: i === 1 ? 100 : 180,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: 48,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--color-error-bg)",
          color: "var(--color-error)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        !
      </div>
      <span style={{ fontSize: 14, color: "var(--color-error)", fontWeight: 500 }}>
        {message}
      </span>
      <button type="button" onClick={onRetry} className="zyn-btn zyn-btn--primary">
        Tentar novamente
      </button>
    </div>
  );
}

function LastUpdatedCounter({ lastUpdated }: { lastUpdated: Date | null }) {
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!lastUpdated) return;
    const update = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - lastUpdated.getTime()) / 1000);
      setSecondsAgo(elapsed);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  if (!lastUpdated) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--color-text-muted)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--color-success)",
          animation: "pulse 2s ease-in-out infinite",
        }}
        title="Dados em tempo real"
      />
      <span>Atualizado há {secondsAgo}s</span>
    </div>
  );
}

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

export function OverviewPage(props: OverviewPageProps) {
  const vm = useOverviewPage({ me: props.me });
  const activityItems = buildActivityItems(vm);

  if (vm.loading && !vm.hasData) return <LoadingSkeleton />;
  if (vm.error && !vm.hasData)
    return <ErrorState message={vm.error} onRetry={vm.refresh} />;

  // Derived metrics — all from real API data
  const revenue = vm.storeOverview?.revenue ?? vm.checkoutOverview?.incremental_revenue ?? 0;
  const orders = vm.storeOverview?.orders_count ?? vm.checkoutOverview?.orders_completed ?? 0;
  const conversion = vm.checkoutOverview?.conversion_rate_with_agent ?? 0;
  const avgTicket = vm.storeOverview?.average_ticket ?? 0;
  const newCustomers = vm.storeOverview?.new_customers ?? 0;
  const productsSold = vm.storeOverview?.products_sold ?? 0;
  const abandonmentRate = vm.storeOverview?.abandonment_rate ?? 0;
  const avgDiscount = vm.checkoutOverview?.average_discount ?? 0;

  const prevRevenue = vm.previousStoreOverview?.revenue ?? vm.previousCheckoutOverview?.incremental_revenue;
  const prevOrders = vm.previousStoreOverview?.orders_count ?? vm.previousCheckoutOverview?.orders_completed;
  const prevConversion = vm.previousCheckoutOverview?.conversion_rate_with_agent;
  const prevAvgTicket = vm.previousStoreOverview?.average_ticket;
  const prevNewCustomers = vm.previousStoreOverview?.new_customers;
  const prevProductsSold = vm.previousStoreOverview?.products_sold;
  const prevAbandonment = vm.previousStoreOverview?.abandonment_rate;
  const prevAvgDiscount = vm.previousCheckoutOverview?.average_discount;

  const revSparkline = vm.timeseries?.revenue_daily?.map((d) => d.value) ?? [];
  const ordersSparkline = vm.timeseries?.orders_daily?.map((d) => d.value) ?? [];
  const convSparkline = vm.timeseries?.conversion_daily?.map((d) => d.value) ?? [];

  // ── Funnel definitions based on real tracked events ──
  // FUNIL DA LOJA: jornada até o checkout
  const STORE_FUNNEL = [
    { name: "checkout_started", label: "Sessão iniciada", color: "var(--color-brand)" },
    { name: "product_viewed", label: "Produto visualizado", color: "oklch(70% 0.14 250)" },
    { name: "cart_viewed", label: "Produto adicionado ao carrinho", color: "oklch(65% 0.16 200)" },
    { name: "auth_phone_submitted", label: "Cadastro iniciado", color: "var(--color-info)" },
    { name: "auth_registration_completed", label: "Cadastro completo", color: "var(--color-success)" },
    { name: "cross_sell_added", label: "Cross-sell aceito", color: "var(--color-warning)" },
  ];

  // FUNIL DE CHECKOUT: jornada de compra (nomes batem com get-funnel.use-case.ts STEP_DEFINITIONS)
  const CHECKOUT_FUNNEL = [
    { name: "checkout_started", label: "Checkout iniciado", color: "var(--color-brand)" },
    { name: "auth_completed", label: "Identificação (OTP)", color: "oklch(68% 0.13 280)" },
    { name: "shipping_calculated", label: "Frete selecionado", color: "oklch(70% 0.14 250)" },
    { name: "coupon_applied", label: "Cupom aplicado", color: "var(--color-warning)" },
    { name: "payment_method_selected", label: "Pagamento selecionado", color: "oklch(65% 0.16 200)" },
    { name: "order_completed", label: "Pagamento concluído", color: "var(--color-success)" },
    { name: "payment_failed", label: "Pagamento falhado", color: "var(--color-error)" },
  ];

  const storefrontRaw = vm.storefrontFunnelData?.steps ?? vm.funnelData?.steps ?? [];
  const checkoutRaw = vm.funnelData?.steps ?? [];

  const storefrontSteps = STORE_FUNNEL
    .map((def) => {
      const found = storefrontRaw.find((s) => s.name === def.name);
      if (!found) return null;
      if (def.name === "cross_sell_added" && found.count === 0) return null;
      return { label: def.label, value: found.count, color: def.color };
    })
    .filter(Boolean) as Array<{ label: string; value: number; color: string }>;

  const checkoutSteps = CHECKOUT_FUNNEL
    .map((def) => {
      const found = checkoutRaw.find((s) => s.name === def.name);
      if (!found) return null;
      if (def.name === "payment_failed" && found.count === 0) return null;
      return { label: def.label, value: found.count, color: def.color };
    })
    .filter(Boolean) as Array<{ label: string; value: number; color: string }>;

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Início</span>
          <h1>Visão Geral</h1>
          <p className="page-lead">Métricas consolidadas do seu negócio</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          <LastUpdatedCounter lastUpdated={vm.lastUpdated} />
          <PeriodSelector value={vm.period} onChange={vm.setPeriod} />
          <button
            type="button"
            onClick={() => void vm.refresh()}
            disabled={vm.loading}
            className="icon-btn"
            title="Atualizar dados"
            style={{ width: 34, height: 34, border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--surface-2)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: vm.loading ? "spin 1s linear infinite" : undefined }}
            >
              <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
              <polyline points="1.5 2 1.5 5.5 5 5.5" />
              <polyline points="14.5 14 14.5 10.5 11 10.5" />
            </svg>
          </button>
        </div>
      </header>

      {/* KPIs — 8 cards, all real data, uniform grid */}
      <SectionErrorBoundary sectionName="KPIs">
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard
          label="Receita Total"
          value={formatCurrency(revenue)}
          prefix="R$"
          icon={<DollarSign size={16} />}
          accent="var(--color-brand)"
          trend={calcTrend(revenue, prevRevenue)}
          sparkline={revSparkline}
        />
        <StatCard
          label="Pedidos"
          value={orders}
          icon={<Package size={16} />}
          trend={calcTrend(orders, prevOrders)}
          sparkline={ordersSparkline}
        />
        <StatCard
          label="Conversão"
          value={`${(conversion * 100).toFixed(1)}`}
          suffix="%"
          icon={<Percent size={16} />}
          accent="var(--color-success)"
          trend={calcTrend(conversion * 100, prevConversion ? prevConversion * 100 : undefined)}
          sparkline={convSparkline}
        />
        <StatCard
          label="Ticket Médio"
          value={formatCurrency(avgTicket)}
          prefix="R$"
          icon={<Receipt size={16} />}
          trend={calcTrend(avgTicket, prevAvgTicket)}
        />
        <StatCard
          label="Novos Clientes"
          value={newCustomers}
          icon={<Users size={16} />}
          accent="var(--color-brand)"
          trend={calcTrend(newCustomers, prevNewCustomers)}
        />
        <StatCard
          label="Produtos Vendidos"
          value={productsSold}
          icon={<ShoppingCart size={16} />}
          trend={calcTrend(productsSold, prevProductsSold)}
        />
        <StatCard
          label="Abandono"
          value={`${(abandonmentRate * 100).toFixed(1)}`}
          suffix="%"
          icon={<TrendingDown size={16} />}
          accent="var(--color-error)"
          trend={calcTrend(abandonmentRate * 100, prevAbandonment ? prevAbandonment * 100 : undefined)}
        />
        <StatCard
          label="Desconto Médio"
          value={`${avgDiscount.toFixed(1)}`}
          suffix="%"
          icon={<BarChart3 size={16} />}
          accent="var(--color-warning)"
          trend={calcTrend(avgDiscount, prevAvgDiscount)}
        />
      </div>
      </SectionErrorBoundary>

      {/* Charts side by side */}
      <SectionErrorBoundary sectionName="Gráficos">
      {(vm.timeseries?.revenue_daily?.length || vm.timeseries?.conversion_daily?.length) ? (
        <div className="grid-2" style={{ gap: 16, minWidth: 0 }}>
          {vm.timeseries?.revenue_daily && vm.timeseries.revenue_daily.length > 0 ? (
            <RevenueChart
              data={vm.timeseries.revenue_daily}
              type="bar"
              label="Receita diária"
              color="var(--color-brand)"
              valueFormat="currency"
            />
          ) : null}

          {vm.timeseries?.conversion_daily && vm.timeseries.conversion_daily.length > 0 ? (
            <RevenueChart
              data={vm.timeseries.conversion_daily}
              type="line"
              label="Conversão diária"
              color="var(--color-brand)"
              valueFormat="percent"
            />
          ) : null}
        </div>
      ) : (
        <div style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", padding: "48px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: "var(--radius-sm)", background: "var(--color-brand-subtle)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={22} color="var(--color-brand)" />
          </div>
          <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>Gráficos aparecerão aqui</div>
          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", maxWidth: 320 }}>Quando transações forem processadas, gráficos de receita e conversão aparecerão automaticamente.</div>
        </div>
      )}
      </SectionErrorBoundary>

      {/* Two funnels side by side — Storefront journey + Checkout journey */}
      <SectionErrorBoundary sectionName="Funis">
      <div className="grid-2" style={{ gap: 16, minWidth: 0 }}>
        {/* Funil Storefront — jornada de aquisição/cadastro */}
        {storefrontSteps.length > 0 ? (
          <ConversionFunnel title="Funil de Aquisição" steps={storefrontSteps} />
        ) : (
          <div className="panel"><EmptyState icon={Users} title="Funil de Aquisição" description="Sessão, adição ao carrinho e etapas do cadastro aparecerão aqui." /></div>
        )}

        {/* Funil Checkout — jornada de compra */}
        {checkoutSteps.length > 0 ? (
          <ConversionFunnel title="Funil de Checkout" steps={checkoutSteps} />
        ) : (
          <div className="panel"><EmptyState icon={BarChart3} title="Funil de Checkout" description="Frete, cupom, pagamento e conclusão aparecerão aqui." /></div>
        )}
      </div>
      </SectionErrorBoundary>

      {/* Bottom: Top Products + Donut + Activity (3 equal columns) */}
      <SectionErrorBoundary sectionName="Produtos e Atividade">
      <div className="grid-3" style={{ gap: 16, minWidth: 0 }}>
        {vm.storeOverview?.top_products && vm.storeOverview.top_products.length > 0 ? (
          <TopProducts products={vm.storeOverview.top_products} />
        ) : (
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-brand)", margin: 0, fontFamily: "var(--font-sans)", letterSpacing: -0.3 }}>Top Produtos</h3>
            <EmptyState icon={ShoppingCart} title="Sem vendas" description="Ranking de produtos aparecerá após as primeiras vendas." />
          </div>
        )}

        {vm.storeOverview?.orders_by_status && Object.values(vm.storeOverview.orders_by_status).some(v => v > 0) ? (
          <OrderStatusDonut data={vm.storeOverview.orders_by_status} />
        ) : (
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-brand)", margin: 0, fontFamily: "var(--font-sans)", letterSpacing: -0.3 }}>Pedidos por Status</h3>
            <EmptyState icon={BarChart3} title="Sem pedidos" description="Distribuição de status aparecerá após pedidos processados." />
          </div>
        )}

        <ActivityFeed items={activityItems} />
      </div>
      </SectionErrorBoundary>
    </div>
  );
}
