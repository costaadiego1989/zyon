import React from "react";
import type { FunnelData } from "../useFunnelPage.js";

interface FunnelMetricsProps {
  data: FunnelData;
}

export function FunnelMetrics({ data }: FunnelMetricsProps): React.ReactElement {
  const { totalSessions, overallConversion, transitions, steps, previous } = data;

  let biggestDropOff = 0;
  let biggestDropOffStep = "";
  for (const t of transitions) {
    if (t.dropOff > biggestDropOff) {
      biggestDropOff = t.dropOff;
      biggestDropOffStep = t.from;
    }
  }
  const dropOffLabel = steps.find((s) => s.name === biggestDropOffStep)?.label ?? "—";

  const totalTimeSeconds = transitions.reduce((sum, t) => sum + t.avgTimeSeconds, 0);
  const avgTimeStr = totalTimeSeconds > 0
    ? `${Math.floor(totalTimeSeconds / 60)}m ${Math.round(totalTimeSeconds % 60)}s`
    : "—";

  function trend(current: number, prev?: number) {
    if (prev === undefined || prev === 0) return null;
    const diff = current - prev;
    const isUp = diff > 0;
    return (
      <span className={`fnl-metric-trend ${isUp ? "up" : "down"}`}>
        {isUp ? "↑" : "↓"} {Math.abs(diff).toFixed(1)}%
      </span>
    );
  }

  return (
    <div className="fnl-metrics">
      <div className="fnl-metric">
        <span className="fnl-metric-label">Conversão</span>
        <span className="fnl-metric-value">{overallConversion.toFixed(1)}<small style={{ fontSize: "60%", opacity: 0.7 }}>%</small></span>
        {previous ? trend(overallConversion, previous.overallConversion) : <span className="fnl-metric-trend up">↑ 0.0%</span>}
      </div>

      <div className="fnl-metric">
        <span className="fnl-metric-label">Sessões</span>
        <span className="fnl-metric-value neutral">{totalSessions.toLocaleString("pt-BR")}</span>
        {previous ? trend(totalSessions, previous.totalSessions) : <span className="fnl-metric-trend up">↑ 0.0%</span>}
      </div>

      <div className="fnl-metric">
        <span className="fnl-metric-label">Maior Drop-off</span>
        <span className={`fnl-metric-value${biggestDropOff > 50 ? " danger" : ""}`}>{biggestDropOff.toFixed(0)}<small style={{ fontSize: "60%", opacity: 0.7 }}>%</small></span>
        <span className="fnl-metric-secondary">{dropOffLabel}</span>
      </div>

      <div className="fnl-metric">
        <span className="fnl-metric-label">Tempo Médio</span>
        <span className="fnl-metric-value neutral">{avgTimeStr}</span>
        <span className="fnl-metric-secondary">checkout completo</span>
      </div>
    </div>
  );
}
