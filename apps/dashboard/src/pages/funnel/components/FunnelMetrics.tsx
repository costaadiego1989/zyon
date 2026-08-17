import React from "react";
import type { FunnelData } from "../useFunnelPage.js";

interface FunnelMetricsProps {
  data: FunnelData;
}

export function FunnelMetrics({ data }: FunnelMetricsProps): React.ReactElement {
  const { totalSessions, overallConversion, transitions, steps, previous } = data;

  // Find biggest drop-off
  let biggestDropOff = 0;
  let biggestDropOffStep = "";
  for (const t of transitions) {
    if (t.dropOff > biggestDropOff) {
      biggestDropOff = t.dropOff;
      biggestDropOffStep = t.from;
    }
  }
  const dropOffStepLabel =
    steps.find((s) => s.name === biggestDropOffStep)?.label ?? biggestDropOffStep;

  // Average time: sum avgTimeSeconds across all transitions
  const totalTimeSeconds = transitions.reduce((sum, t) => sum + t.avgTimeSeconds, 0);
  const minutes = Math.floor(totalTimeSeconds / 60);
  const seconds = Math.round(totalTimeSeconds % 60);
  const avgTimeStr = totalTimeSeconds > 0 ? `${minutes}m ${seconds}s` : "—";

  // Comparison helper
  function renderComparison(currentVal: number, previousVal?: number) {
    if (!previousVal || previousVal === 0) return null;
    const diff = currentVal - previousVal;
    const isUp = diff > 0;
    return (
      <span className={`funnel-metric-comparison ${isUp ? "positive" : "negative"}`}>
        {isUp ? "↑" : "↓"} {Math.abs(diff).toFixed(1)}pp
      </span>
    );
  }

  return (
    <div className="funnel-metrics">
      {/* Primary: Conversion Rate (featured, larger) */}
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Conversão Geral</span>
        <span className="funnel-metric-value">{overallConversion.toFixed(1)}%</span>
        {previous && renderComparison(overallConversion, previous.overallConversion)}
      </div>

      {/* Secondary Row 1: Total Sessions */}
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Total Sessões</span>
        <span className="funnel-metric-value">{totalSessions.toLocaleString("pt-BR")}</span>
        {previous && renderComparison(totalSessions, previous.totalSessions)}
      </div>

      {/* Secondary Row 2: Biggest Drop-off */}
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Maior Drop-off</span>
        <span className="funnel-metric-value">{biggestDropOff.toFixed(0)}%</span>
        <span className="funnel-metric-secondary">{dropOffStepLabel}</span>
      </div>
    </div>
  );
}
