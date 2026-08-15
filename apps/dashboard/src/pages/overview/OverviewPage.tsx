import React, { useState, useEffect } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useOverviewPage } from "./useOverviewPage.js";
import { PeriodSelector } from "./components/PeriodSelector.js";
import { ActivityFeed, type ActivityItem } from "./components/ActivityFeed.js";
import { CheckoutMetrics } from "./sections/CheckoutMetrics.js";
import { StoreMetrics } from "./sections/StoreMetrics.js";
import { StatCard } from "./components/StatCard.js";
import { RevenueChart } from "./components/RevenueChart.js";

export type OverviewPageProps = {
  apiBaseUrl: string;
  defaultMerchantId: string;
  me: MerchantProfile;
};

type TabId = "resumo" | "checkout" | "loja";

function buildActivityItems(vm: ReturnType<typeof useOverviewPage>): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (vm.checkoutOverview?.recent_sessions) {
    for (const s of (vm.checkoutOverview.recent_sessions ?? []).slice(0, 5)) {
      items.push({
        id: s.sessionId ?? `session-${items.length}`,
        type: "session",
        description: `Sessao iniciada`,
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
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 14,
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
          width: 48,
          height: 48,
          borderRadius: 12,
          background: "var(--danger-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
        }}
      >
        !
      </div>
      <span style={{ fontSize: 14, color: "var(--danger)", fontWeight: 500 }}>
        {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          background: "var(--accent)",
          color: "var(--color-bg)",
          border: "none",
          borderRadius: 8,
          padding: "10px 24px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--sans)",
          transition: "opacity 200ms",
        }}
      >
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
        color: "var(--muted)",
        fontFamily: "var(--mono)",
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--good)",
          animation: "pulse 2s ease-in-out infinite",
        }}
        title="Dados em tempo real"
      />
      <span>Atualizado ha {secondsAgo}s</span>
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

function SectionTabs({
  activeTab,
  onTabChange,
  showCheckout,
  showStore,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showCheckout: boolean;
  showStore: boolean;
}) {
  const tabs: Array<{ id: TabId; label: string; visible: boolean }> = [
    { id: "resumo", label: "Resumo", visible: true },
    { id: "checkout", label: "Checkout", visible: showCheckout },
    { id: "loja", label: "Loja", visible: showStore },
  ];

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: "oklch(16% 0.003 145)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 4,
        gap: 2,
      }}
    >
      {tabs
        .filter((t) => t.visible)
        .map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              style={{
                background: active ? "var(--card)" : "transparent",
                color: active ? "var(--ink)" : "var(--muted)",
                border: active ? "1px solid var(--border)" : "1px solid transparent",
                borderRadius: 8,
                padding: "8px 18px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--sans)",
                cursor: "pointer",
                transition:
                  "all 200ms cubic-bezier(0.16,1,0.3,1)",
                boxShadow: active
                  ? "0 2px 8px rgba(0,0,0,0.2)"
                  : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
    </div>
  );
}

function HeroMetrics({
  vm,
}: {
  vm: ReturnType<typeof useOverviewPage>;
}) {
  const revSparkline = vm.timeseries?.revenue_daily?.map((d) => d.value) ?? [];
  const ordersSparkline = vm.timeseries?.orders_daily?.map((d) => d.value) ?? [];
  const convSparkline = vm.timeseries?.conversion_daily?.map((d) => d.value) ?? [];

  const revenue = vm.storeOverview?.revenue ?? vm.checkoutOverview?.incremental_revenue ?? 0;
  const orders = vm.storeOverview?.orders_count ?? vm.checkoutOverview?.orders_completed ?? 0;
  const conversion = vm.checkoutOverview?.conversion_rate_with_agent ?? 0;
  const avgTicket = vm.storeOverview?.average_ticket ?? 0;

  const prevRevenue = vm.previousStoreOverview?.revenue ?? vm.previousCheckoutOverview?.incremental_revenue;
  const prevOrders = vm.previousStoreOverview?.orders_count ?? vm.previousCheckoutOverview?.orders_completed;
  const prevConversion = vm.previousCheckoutOverview?.conversion_rate_with_agent;
  const prevAvgTicket = vm.previousStoreOverview?.average_ticket;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      <StatCard
        label="Receita Total"
        value={formatCurrency(revenue)}
        prefix="R$"
        accent="var(--accent)"
        trend={calcTrend(revenue, prevRevenue)}
        sparkline={revSparkline}
      />
      <StatCard
        label="Pedidos"
        value={orders}
        trend={calcTrend(orders, prevOrders)}
        sparkline={ordersSparkline}
      />
      <StatCard
        label="Conversao"
        value={`${(conversion * 100).toFixed(1)}`}
        suffix="%"
        accent="var(--good)"
        trend={calcTrend(
          conversion * 100,
          prevConversion ? prevConversion * 100 : undefined,
        )}
        sparkline={convSparkline}
      />
      <StatCard
        label="Ticket Medio"
        value={formatCurrency(avgTicket)}
        prefix="R$"
        trend={calcTrend(avgTicket, prevAvgTicket)}
      />
    </div>
  );
}

export function OverviewPage(props: OverviewPageProps) {
  const vm = useOverviewPage({ me: props.me });
  const activityItems = buildActivityItems(vm);
  const [activeTab, setActiveTab] = useState<TabId>("resumo");

  if (vm.loading && !vm.hasData) return <LoadingSkeleton />;
  if (vm.error && !vm.hasData)
    return <ErrorState message={vm.error} onRetry={vm.refresh} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>INÍCIO</div>
          <h2
            style={{
              font: "700 22px var(--serif)",
              color: "var(--ink)",
              letterSpacing: "-0.02em",
              margin: 0,
              marginBottom: 6,
            }}
          >
            Visão Geral
          </h2>
          <p
            style={{
              font: "17px var(--serif)",
              fontStyle: "italic",
              color: "var(--muted)",
              margin: 0,
            }}
          >
            Métricas consolidadas do seu negócio
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <LastUpdatedCounter lastUpdated={vm.lastUpdated} />
          <PeriodSelector value={vm.period} onChange={vm.setPeriod} />
          <button
            type="button"
            onClick={() => void vm.refresh()}
            disabled={vm.loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--card)",
              cursor: vm.loading ? "default" : "pointer",
              color: "var(--muted)",
              fontSize: 14,
              transition: "all 170ms cubic-bezier(0.16,1,0.3,1)",
            }}
            title="Atualizar dados"
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
              style={{
                animation: vm.loading ? "spin 1s linear infinite" : undefined,
              }}
            >
              <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
              <polyline points="1.5 2 1.5 5.5 5 5.5" />
              <polyline points="14.5 14 14.5 10.5 11 10.5" />
            </svg>
          </button>
        </div>
      </header>

      {/* Section Tabs */}
      <SectionTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        showCheckout={vm.showCheckout}
        showStore={vm.showStore}
      />

      {/* Tab content */}
      {activeTab === "resumo" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <HeroMetrics vm={vm} />

          {/* Bento grid: charts left (2/3), activity right (1/3) */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 12,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              {vm.timeseries?.revenue_daily &&
              vm.timeseries.revenue_daily.length > 0 ? (
                <RevenueChart
                  data={vm.timeseries.revenue_daily}
                  type="bar"
                  label="Receita diaria"
                  color="var(--accent)"
                  valueFormat="currency"
                />
              ) : null}

              {vm.timeseries?.conversion_daily &&
              vm.timeseries.conversion_daily.length > 0 ? (
                <RevenueChart
                  data={vm.timeseries.conversion_daily}
                  type="line"
                  label="Conversao diaria"
                  color="var(--accent)"
                  valueFormat="percent"
                />
              ) : null}
            </div>

            <ActivityFeed items={activityItems} />
          </div>
        </div>
      )}

      {activeTab === "checkout" && vm.showCheckout && vm.checkoutOverview && (
        <CheckoutMetrics
          overview={vm.checkoutOverview}
          previousOverview={vm.previousCheckoutOverview}
          timeseries={vm.timeseries}
        />
      )}

      {activeTab === "loja" && vm.showStore && vm.storeOverview && (
        <StoreMetrics
          overview={vm.storeOverview}
          previousOverview={vm.previousStoreOverview}
          timeseries={vm.timeseries}
        />
      )}
    </div>
  );
}
