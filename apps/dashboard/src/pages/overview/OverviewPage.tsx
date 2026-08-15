import React, { useState, useEffect } from "react";
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
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--good)",
          animation: "pulse 2s ease-in-out infinite",
        }}
        title="Dados em tempo real"
      />
      <span>Última atualização: há {secondsAgo}s</span>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)", margin: 0 }}>
            Visão Geral
          </h2>
          <LastUpdatedCounter lastUpdated={vm.lastUpdated} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PeriodSelector value={vm.period} onChange={vm.setPeriod} />
          <button
            type="button"
            onClick={() => void vm.refresh()}
            disabled={vm.loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--card)",
              cursor: vm.loading ? "default" : "pointer",
              color: "var(--muted)",
              fontSize: 14,
              transition: "background 0.15s",
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

      {vm.showCheckout && vm.checkoutOverview && (
        <CheckoutMetrics
          overview={vm.checkoutOverview}
          previousOverview={vm.previousCheckoutOverview}
          timeseries={vm.timeseries}
        />
      )}

      {vm.showStore && vm.storeOverview && (
        <StoreMetrics
          overview={vm.storeOverview}
          previousOverview={vm.previousStoreOverview}
          timeseries={vm.timeseries}
        />
      )}

      <ActivityFeed items={activityItems} />
    </div>
  );
}
