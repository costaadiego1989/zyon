import React from "react";
import type { FunnelPeriod, FunnelBreakdownDimension } from "../useFunnelPage.js";

const PERIODS: { value: FunnelPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

const BREAKDOWNS: { value: FunnelBreakdownDimension; label: string }[] = [
  { value: "none", label: "Sem segmentação" },
  { value: "device", label: "Por dispositivo" },
  { value: "buyer_type", label: "Por tipo de comprador" },
  { value: "payment_method", label: "Por pagamento" },
];

interface FunnelFiltersProps {
  period: FunnelPeriod;
  onPeriodChange: (p: FunnelPeriod) => void;
  breakdown: FunnelBreakdownDimension;
  onBreakdownChange: (b: FunnelBreakdownDimension) => void;
  compareEnabled: boolean;
  onCompareChange: (v: boolean) => void;
}

export function FunnelFilters({
  period,
  onPeriodChange,
  breakdown,
  onBreakdownChange,
  compareEnabled,
  onCompareChange,
}: FunnelFiltersProps): React.ReactElement {
  return (
    <div className="funnel-filters" role="group" aria-label="Filtros do funil">
      <div className="funnel-period-group" role="group" aria-label="Período do funil">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`funnel-period-btn${period === p.value ? " active" : ""}`}
            onClick={() => onPeriodChange(p.value)}
            aria-pressed={period === p.value}
          >
            {p.label}
          </button>
        ))}
      </div>

      <select
        className="funnel-breakdown-select"
        value={breakdown}
        onChange={(e) => onBreakdownChange(e.target.value as FunnelBreakdownDimension)}
        aria-label="Segmentação"
      >
        {BREAKDOWNS.map((b) => (
          <option key={b.value} value={b.value}>{b.label}</option>
        ))}
      </select>

      <label className="funnel-compare-toggle" aria-label="Comparar com período anterior">
        <input
          type="checkbox"
          checked={compareEnabled}
          onChange={(e) => onCompareChange(e.target.checked)}
        />
        <span>Comparar</span>
      </label>
    </div>
  );
}
