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
    const diffPercentage = Math.round(diff * 10) / 10;
    const isUp = diff > 0;
    return (
      <span className={`funnel-metric-comparison ${isUp ? "positive" : "negative"}`}>
        {isUp ? "↑" : "↓"} {Math.abs(diffPercentage).toFixed(1)}pp
      </span>
    );
  }

  return (
    <div className="funnel-metrics">
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Total sessões</span>
        <span className="funnel-metric-value">{totalSessions.toLocaleString("pt-BR")}</span>
        {previous && renderComparison(totalSessions, previous.totalSessions)}
      </div>
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Conversão geral</span>
        <span className="funnel-metric-value">{(overallConversion * 100).toFixed(1)}%</span>
        {previous && renderComparison(overallConversion, previous.overallConversion)}
      </div>
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Maior drop-off</span>
        <span className="funnel-metric-value">{(biggestDropOff * 100).toFixed(0)}%</span>
        <span className="funnel-metric-secondary">{dropOffStepLabel}</span>
      </div>
      <div className="funnel-metric-card">
        <span className="funnel-metric-label">Tempo médio total</span>
        <span className="funnel-metric-value">{avgTimeStr}</span>
      </div>
    </div>
  );
}
