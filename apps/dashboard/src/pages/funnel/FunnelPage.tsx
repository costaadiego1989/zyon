import React from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useFunnelPage } from "./useFunnelPage.js";
import { FunnelFilters } from "./components/FunnelFilters.js";
import { FunnelMetrics } from "./components/FunnelMetrics.js";
import { FunnelChart } from "./components/FunnelChart.js";
import { FunnelBreakdown } from "./components/FunnelBreakdown.js";
import { ActiveSessionsList } from "./components/ActiveSessionsList.js";
import { BottleneckBanner } from "./components/BottleneckBanner.js";
import "./funnel-page.css";

interface FunnelPageProps {
  apiBaseUrl: string;
  me: MerchantProfile;
}

function LoadingSkeleton(): React.ReactElement {
  return (
    <div className="funnel-loading">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="funnel-skeleton" style={{ height: i === 1 ? 120 : 200 }} />
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }): React.ReactElement {
  return (
    <div style={{ padding: "48px", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--danger)", marginBottom: 16 }}>
        Erro ao carregar funil: {error}
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          background: "var(--accent)",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "10px 24px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--sans)",
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

export function FunnelPage({ apiBaseUrl, me }: FunnelPageProps): React.ReactElement {
  const vm = useFunnelPage({
    apiBaseUrl,
    merchantId: me.id,
    merchantName: me.name,
  });

  return (
    <div className="dashboard-content funnel-page">
      {/* ── Header ── */}
      <header className="funnel-head">
        <div>
          <h1>Funil de Conversão</h1>
          <p className="page-lead">Acompanhe o progresso dos visitantes em cada etapa do checkout</p>
        </div>
        <div className="funnel-header-controls">
          <button
            type="button"
            className="funnel-export-btn"
            onClick={vm.exportCsv}
            disabled={!vm.data}
            title="Exportar dados em CSV"
          >
            Exportar CSV
          </button>
          <FunnelFilters
            period={vm.period}
            onPeriodChange={vm.setPeriod}
            breakdown={vm.breakdown}
            onBreakdownChange={vm.setBreakdown}
            compareEnabled={vm.compareEnabled}
            onCompareChange={vm.setCompareEnabled}
          />
        </div>
      </header>

      {/* ── Loading ── */}
      {vm.loading ? (
        <LoadingSkeleton />
      ) : vm.error ? (
        <ErrorState error={vm.error} onRetry={vm.refresh} />
      ) : vm.data ? (
        <>
          {/* ── Bottleneck Banner ── */}
          {vm.data.bottleneck && (
            <BottleneckBanner bottleneck={vm.data.bottleneck} steps={vm.data.steps} />
          )}

          {/* ── Metrics Row ── */}
          <FunnelMetrics data={vm.data} />

          {/* ── Chart ── */}
          <div className="funnel-chart-container">
            <FunnelChart steps={vm.data.steps} transitions={vm.data.transitions} />
          </div>

          {/* ── Breakdown ── */}
          {vm.breakdown !== "none" && vm.data.breakdowns && (
            <FunnelBreakdown breakdowns={vm.data.breakdowns} dimension={vm.breakdown} />
          )}

          {/* ── Active Sessions ── */}
          <ActiveSessionsList sessions={vm.sessions} loading={vm.loading} />
        </>
      ) : null}
    </div>
  );
}
