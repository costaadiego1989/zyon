import React from "react";
import { TrendingUp, Users, AlertTriangle, Clock } from "lucide-react";
import { StatCard } from "../../overview/components/StatCard.js";
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

  const convTrend = previous && previous.overallConversion > 0
    ? overallConversion - previous.overallConversion
    : undefined;
  const sessionsTrend = previous && previous.totalSessions > 0
    ? ((totalSessions - previous.totalSessions) / previous.totalSessions) * 100
    : undefined;

  return (
    <div className="fnl-metrics">
      <StatCard
        label="Conversão"
        value={`${overallConversion.toFixed(1)}`}
        suffix="%"
        trend={convTrend ?? 0}
        icon={<TrendingUp size={16} />}
        accent="var(--color-brand)"
      />
      <StatCard
        label="Sessões"
        value={totalSessions}
        trend={sessionsTrend ?? 0}
        icon={<Users size={16} />}
      />
      <StatCard
        label="Maior Drop-off"
        value={`${biggestDropOff.toFixed(0)}%`}
        icon={<AlertTriangle size={16} />}
        accent={biggestDropOff > 50 ? "var(--color-error)" : undefined}
      />
      <StatCard
        label="Tempo Médio"
        value={avgTimeStr}
        icon={<Clock size={16} />}
      />
    </div>
  );
}
