import React from "react";
import { Download } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { useFunnelPage } from "./useFunnelPage.js";
import { FunnelChart } from "./components/FunnelChart.js";
import { FunnelMetrics } from "./components/FunnelMetrics.js";
import { FunnelBreakdown } from "./components/FunnelBreakdown.js";
import { ActiveSessionsList } from "./components/ActiveSessionsList.js";
import { BottleneckBanner } from "./components/BottleneckBanner.js";
import "./funnel-page.css";

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
] as const;

export function FunnelPage({ apiBaseUrl, me }: { apiBaseUrl: string; me: MerchantProfile }) {
  const vm = useFunnelPage({ apiBaseUrl, merchantId: me.id, merchantName: me.name });

  return (
    <div className="dashboard-content funnel-page">
      {/* ── Header ── */}
      <header className="fnl-head">
        <div className="fnl-head-left">
          <span className="fnl-eyebrow">Checkout</span>
          <h1 className="fnl-title">Funil de Conversão</h1>
          <p className="fnl-subtitle">Métricas de progresso dos visitantes em cada etapa</p>
        </div>
        <div className="fnl-head-right">
          <div className="fnl-period-bar">
            {PERIODS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`fnl-period-btn${vm.period === key ? " active" : ""}`}
                onClick={() => vm.setPeriod(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Controls ── */}
      <div className="fnl-controls">
        <select
          value={vm.breakdown}
          onChange={(e) => vm.setBreakdown(e.target.value as any)}
        >
          <option value="none">Sem segmentação</option>
          <option value="device">Por dispositivo</option>
          <option value="buyer_type">Por tipo de comprador</option>
          <option value="payment_method">Por pagamento</option>
        </select>

        <label>
          <input
            type="checkbox"
            checked={vm.compareEnabled}
            onChange={(e) => vm.setCompareEnabled(e.target.checked)}
          />
          Comparar período
        </label>

        <button
          type="button"
          className="fnl-export-btn"
          onClick={vm.exportCsv}
          disabled={!vm.data}
        >
          <Download size={12} style={{ marginRight: 4 }} />
          Exportar CSV
        </button>
      </div>

      {/* ── Bottleneck ── */}
      {vm.data?.bottleneck && (
        <BottleneckBanner bottleneck={vm.data.bottleneck} steps={vm.data.steps} />
      )}

      {/* ── Metrics (always visible) ── */}
      {vm.data && <FunnelMetrics data={vm.data} />}

      {/* ── Chart + Breakdown ── */}
      <div className={`fnl-body${vm.breakdown === "none" ? " no-breakdown" : ""}`}>
        {vm.data && <FunnelChart steps={vm.data.steps} transitions={vm.data.transitions} />}

        {vm.breakdown !== "none" && vm.data?.breakdowns && (
          <FunnelBreakdown breakdowns={vm.data.breakdowns} dimension={vm.breakdown} />
        )}
      </div>

      {/* ── Active Sessions (always visible) ── */}
      <ActiveSessionsList sessions={vm.sessions} loading={vm.loading} />
    </div>
  );
}
