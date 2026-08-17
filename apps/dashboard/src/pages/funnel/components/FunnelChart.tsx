import React from "react";
import type { FunnelStep, FunnelTransition } from "../useFunnelPage.js";

interface FunnelChartProps {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
}

export function FunnelChart({ steps, transitions }: FunnelChartProps): React.ReactElement {
  return (
    <div className="fnl-chart-card">
      <div className="fnl-chart-head">
        <h3 className="fnl-chart-title">Funil de Etapas</h3>
        <span className="fnl-chart-conversion">
          {steps.length > 0 ? `${steps[steps.length - 1]?.percentage.toFixed(1)}% conversão` : "—"}
        </span>
      </div>
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
