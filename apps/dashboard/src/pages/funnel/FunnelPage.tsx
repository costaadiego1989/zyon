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
  const vm = useFunnelPage({ apiBaseUrl, merchantId: me.id, merchantName: me.name, plan: me.plan });

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
          <select
            value={vm.breakdown}
            onChange={(e) => vm.setBreakdown(e.target.value as any)}
            className="fnl-select"
          >
            <option value="none">Sem segmentação</option>
            <option value="device">Dispositivo</option>
            <option value="buyer_type">Tipo comprador</option>
            <option value="payment_method">Pagamento</option>
          </select>
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
          <button
            type="button"
            className="fnl-export-btn"
            onClick={vm.exportCsv}
            disabled={!vm.data}
            title="Exportar CSV"
          >
            <Download size={13} />
          </button>
        </div>
      </header>

      {/* ── Source Tabs (for BOTH plan) ── */}
      {vm.showSourceTabs && (
        <div className="fnl-source-tabs">
          <button
            type="button"
            className={`fnl-source-tab${vm.funnelSource === "storefront" ? " active" : ""}`}
            onClick={() => vm.setFunnelSource("storefront")}
          >
            Jornada completa
          </button>
          <button
            type="button"
            className={`fnl-source-tab${vm.funnelSource === "checkout" ? " active" : ""}`}
            onClick={() => vm.setFunnelSource("checkout")}
          >
            Widget Checkout
          </button>
        </div>
      )}

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
