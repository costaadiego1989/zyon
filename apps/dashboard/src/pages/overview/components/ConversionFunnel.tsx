import React from "react";

export type FunnelStep = {
  label: string;
  value: number;
  color?: string;
};

export type ConversionFunnelProps = {
  steps: FunnelStep[];
  title?: string;
};

export function ConversionFunnel({ steps, title }: ConversionFunnelProps) {
  if (!steps || steps.length === 0) return null;
  const max = Math.max(...steps.map((s) => s.value ?? 0), 1);
  const first = steps[0]?.value ?? 0;
  const last = steps[steps.length - 1]?.value ?? 0;
  const overallConversion = first > 0 ? ((last / first) * 100).toFixed(1) : "0";

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h4
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-brand)",
              margin: 0,
              fontFamily: "var(--font-sans)",
              letterSpacing: -0.3,
            }}
          >
            {title}
          </h4>
          <span style={{ font: "600 11px var(--font-mono)", color: "var(--color-success)" }}>
            {overallConversion}% total
          </span>
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "center",
        }}
      >
        {steps.map((step, i) => {
          const fill = step.color ?? "var(--color-brand)";
          const prevValue = i > 0 ? steps[i - 1].value : null;
          const convRate =
            prevValue && prevValue > 0 ? ((step.value ?? 0) / prevValue) * 100 : null;
          const widthPercent = Math.max(30, 100 - i * (60 / Math.max(steps.length - 1, 1)));

          return (
            <div
              key={step.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "center",
                width: "100%",
              }}
            >
              <div
                style={{
                  width: `${widthPercent}%`,
                  background: fill,
                  borderRadius: 8,
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "opacity 200ms, transform 200ms",
                  cursor: "default",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.9"; (e.currentTarget as HTMLElement).style.transform = "scale(1.01)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
              >
                <span style={{ font: "700 14px var(--font-mono)", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>
                  {(step.value ?? 0).toLocaleString("pt-BR")}
                </span>
                <span style={{ font: "600 11px var(--font-sans)", color: "rgba(255,255,255,0.9)" }}>
                  {step.label}
                </span>
              </div>

              {convRate !== null && i > 0 && (
                <span
                  style={{
                    font: "700 10px var(--font-mono)",
                    color: convRate >= 50 ? "var(--color-success)" : convRate >= 25 ? "var(--color-warning)" : "var(--color-error)",
                    padding: "1px 0",
                  }}
                >
                  {convRate.toFixed(0)}% conversão
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
        <div>
          <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Entrada</div>
          <div style={{ font: "700 16px var(--font-mono)", color: "var(--color-text)" }}>{first.toLocaleString("pt-BR")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Saída</div>
          <div style={{ font: "700 16px var(--font-mono)", color: "var(--color-text)" }}>{last.toLocaleString("pt-BR")}</div>
        </div>
      </div>
    </div>
  );
}
