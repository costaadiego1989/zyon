import React from "react";
import { Download } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { TabBar } from "../../components/TabBar.js";
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
          <span className="eyebrow">Checkout</span>
          <h1>Funil de Conversão</h1>
          <p className="page-lead">Métricas de progresso dos visitantes em cada etapa</p>
        </div>
        <div className="fnl-head-right">
          <div className="fnl-filters-row">
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
        </div>
      </header>

      {/* ── Source Tabs (for BOTH plan) ── */}
      {vm.showSourceTabs && (
        <TabBar
          tabs={[
            { key: "storefront", label: "Jornada da Loja" },
            { key: "checkout", label: "Jornada do Checkout" },
          ]}
          activeTab={vm.funnelSource}
          onTabChange={(k) => vm.setFunnelSource(k as "storefront" | "checkout")}
        />
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

        {vm.breakdown !== "none" && (
          <FunnelBreakdown
            breakdowns={vm.data?.breakdowns ?? {}}
            dimension={vm.breakdown}
          />
        )}
      </div>

      {/* ── Active Sessions (always visible) ── */}
      <ActiveSessionsList sessions={vm.sessions} loading={vm.loading} />
    </div>
  );
}
