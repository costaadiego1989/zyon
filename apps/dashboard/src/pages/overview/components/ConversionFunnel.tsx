import React from "react";

export type FunnelStep = {
  label: string;
  value: number;
  color?: string;
};

export type ConversionFunnelProps = {
  steps: FunnelStep[];
};

export function ConversionFunnel({ steps }: ConversionFunnelProps) {
  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {steps.map((step, i) => {
        const widthPct = Math.max(8, (step.value / max) * 100);
        const fill = step.color ?? "var(--accent)";
        const drop =
          i === 0
            ? null
            : steps[i - 1].value > 0
              ? ((steps[i - 1].value - step.value) / steps[i - 1].value) * 100
              : 0;

        return (
          <div key={step.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {drop !== null && drop > 0 ? (
              <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", paddingLeft: 4 }}>
                ↓ {drop.toFixed(1)}%
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 110, flexShrink: 0 }}>{step.label}</span>
              <div
                style={{
                  flex: 1,
                  background: "var(--color-surface-alt)",
                  borderRadius: 6,
                  height: 28,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    background: fill,
                    opacity: 0.85,
                    borderRadius: 6,
                    transition: "width 250ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "var(--mono)",
                  fontWeight: 600,
                  color: "var(--ink)",
                  minWidth: 56,
                  textAlign: "right",
                }}
              >
                {step.value.toLocaleString("pt-BR")}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
