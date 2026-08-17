import React, { useMemo } from "react";
import type { FunnelStep, FunnelTransition } from "../useFunnelPage.js";

interface FunnelChartProps {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
}

export function FunnelChart({ steps, transitions }: FunnelChartProps): React.ReactElement {
  const chartData = useMemo(() => {
    return steps.map((step, i) => {
      const transition = transitions.find((t) => t.from === step.name);
      const opacityVariants = [1, 0.8, 0.6, 0.4, 0.2];
      const opacity = opacityVariants[Math.min(i, opacityVariants.length - 1)];

      return {
        step,
        transition,
        opacity,
        dropOffPct: transition ? transition.dropOff.toFixed(0) : "0",
        showDropOff: transition && transition.dropOff > 40,
      };
    });
  }, [steps, transitions]);

  return (
    <div className="fnl-chart">
      {chartData.map((item) => (
        <div key={item.step.name} className="fnl-step">
          <div
            className="fnl-step-bar"
            style={{
              width: `max(${item.step.percentage}%, 180px)`,
              opacity: item.step.count === 0 ? 0.3 : item.opacity,
            }}
          >
            <span className="fnl-step-label">{item.step.label}</span>
            <span className="fnl-step-value">{item.step.count.toLocaleString("pt-BR")}</span>
          </div>
          <div className="fnl-step-meta">
            <span className="fnl-step-pct">{item.step.percentage.toFixed(1)}%</span>
            {item.transition && (
              <span className={`fnl-step-drop${item.showDropOff ? " high" : ""}`}>
                ↓ {item.dropOffPct}% saiu
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
