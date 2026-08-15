import React from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useOverviewPage } from "./useOverviewPage.js";
import { PeriodSelector } from "./components/PeriodSelector.js";
import { ActivityFeed, type ActivityItem } from "./components/ActivityFeed.js";
import { CheckoutMetrics } from "./sections/CheckoutMetrics.js";
import { StoreMetrics } from "./sections/StoreMetrics.js";

export type OverviewPageProps = {
  apiBaseUrl: string;
  defaultMerchantId: string;
  me: MerchantProfile;
};

function buildActivityItems(vm: ReturnType<typeof useOverviewPage>): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (vm.checkoutOverview?.recent_sessions) {
    for (const s of vm.checkoutOverview.recent_sessions.slice(0, 5)) {
      items.push({
        id: s.sessionId ?? `session-${items.length}`,
        type: "session",
        description: `Sessão iniciada`,
        timestamp: s.createdAt ?? new Date().toISOString(),
      });
    }
  }

  if (vm.storeOverview?.recent_orders) {
    for (const o of vm.storeOverview.recent_orders.slice(0, 5)) {
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
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            height: 80,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 32, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 14, color: "var(--danger)" }}>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          background: "var(--accent)",
          color: "var(--color-bg)",
          border: "none",
          borderRadius: 8,
          padding: "8px 20px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

export function OverviewPage(props: OverviewPageProps) {
  const vm = useOverviewPage({ me: props.me });
  const activityItems = buildActivityItems(vm);

  if (vm.loading && !vm.hasData) return <LoadingSkeleton />;
  if (vm.error && !vm.hasData) return <ErrorState message={vm.error} onRetry={vm.refresh} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Visão Geral
        </h2>
        <PeriodSelector value={vm.period} onChange={vm.setPeriod} />
      </header>

      {vm.showCheckout && vm.checkoutOverview && (
        <CheckoutMetrics overview={vm.checkoutOverview} timeseries={vm.timeseries} />
      )}

      {vm.showStore && vm.storeOverview && (
        <StoreMetrics overview={vm.storeOverview} timeseries={vm.timeseries} />
      )}

      <ActivityFeed items={activityItems} />
    </div>
  );
}
