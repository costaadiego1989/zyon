import React from "react";
import type { FunnelPeriod } from "../useFunnelPage.js";

const PERIODS: { value: FunnelPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

interface FunnelFiltersProps {
  period: FunnelPeriod;
  onPeriodChange: (p: FunnelPeriod) => void;
}

export function FunnelFilters({ period, onPeriodChange }: FunnelFiltersProps): React.ReactElement {
  return (
    <div className="funnel-filters" role="group" aria-label="Período do funil">
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
  );
}
