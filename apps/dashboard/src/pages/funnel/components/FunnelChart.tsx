import React from "react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import type { FunnelStep, FunnelTransition } from "../useFunnelPage.js";

interface FunnelChartProps {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
}

export function FunnelChart({ steps, transitions }: FunnelChartProps): React.ReactElement {
  const conversionStep = steps.find(s => s.name === "order_completed") ?? steps[steps.length - 2];
  return (
    <div className="fnl-chart-card">
      <SectionHeader
        variant="secondary"
        title="Funil de Etapas"
        trailing={
          <span className="fnl-chart-conversion">
            {steps.length > 0 ? `${(conversionStep?.percentage ?? 0).toFixed(1)}% conversão` : "—"}
          </span>
        }
      />
      <div className="fnl-bars">
        {steps.map((step, i) => {
          const transition = transitions.find((t) => t.from === step.name);
          const barWidth = Math.max(step.percentage, 20);
          const opacity = step.count === 0 && step.percentage === 0 ? 0.25 : 1 - i * 0.15;

          return (
            <div key={step.name} className="fnl-bar-row">
              <div
                className="fnl-bar"
                style={{
                  width: `${barWidth}%`,
                  opacity,
                }}
              >
                <span className="fnl-bar-label">{step.label}</span>
                <span className="fnl-bar-count">{step.count.toLocaleString("pt-BR")}</span>
              </div>
              <div className="fnl-bar-meta">
                <span className="fnl-bar-pct">{step.percentage.toFixed(1)}%</span>
                {transition && (
                  <span className={`fnl-bar-drop${transition.dropOff > 40 ? " high" : ""}`}>
                    ↓ {transition.dropOff.toFixed(0)}% saiu
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
