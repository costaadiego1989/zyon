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

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {title && (
        <h4
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--ink)",
            margin: 0,
            fontFamily: "var(--sans)",
            letterSpacing: -0.3,
          }}
        >
          {title}
        </h4>
      )}

      {/* Real trapezoid funnel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {steps.map((step, i) => {
          const fill = step.color ?? "var(--accent)";
          const prevValue = i > 0 ? steps[i - 1].value : null;
          const convRate =
            prevValue && prevValue > 0 ? ((step.value ?? 0) / prevValue) * 100 : null;
          const percentage = ((step.value ?? 0) / max) * 100;
          const widthPercent = Math.max(20, 100 - i * 15);

          return (
            <div
              key={step.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: `${widthPercent}%`,
                  minWidth: "50px",
                  background: fill,
                  opacity: 0.85,
                  borderRadius: 12,
                  padding: "20px 24px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  transition: "all 300ms cubic-bezier(0.16,1,0.3,1), opacity 200ms",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = "1";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 8px 24px " + fill + "33";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = "0.85";
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                <span
                  style={{
                    fontSize: 16,
                    fontFamily: "var(--mono)",
                    fontWeight: 700,
                    color: "#fff",
                    textShadow: "0 2px 4px rgba(0,0,0,0.4)",
                  }}
                >
                  {(step.value ?? 0).toLocaleString("pt-BR")}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.9)",
                    fontWeight: 600,
                    fontFamily: "var(--sans)",
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* Percentage labels between steps */}
              {convRate !== null && i > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    fontWeight: 700,
                    color:
                      convRate >= 50
                        ? "var(--good)"
                        : convRate >= 25
                          ? "var(--warn)"
                          : "var(--danger)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      width: 2,
                      height: 8,
                      background: "currentColor",
                      borderRadius: 999,
                    }}
                  />
                  {convRate.toFixed(0)}% conversão
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Entrada
          </div>
          <div
            style={{
              fontSize: 16,
              fontFamily: "var(--mono)",
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            {(steps[0]?.value ?? 0).toLocaleString("pt-BR")}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Saída
          </div>
          <div
            style={{
              fontSize: 16,
              fontFamily: "var(--mono)",
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            {(steps[steps.length - 1]?.value ?? 0).toLocaleString("pt-BR")}
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Conversão Total
          </div>
          <div
            style={{
              fontSize: 16,
              fontFamily: "var(--mono)",
              fontWeight: 700,
              color:
                steps[0]?.value && steps[0].value > 0
                  ? "var(--good)"
                  : "var(--muted)",
            }}
          >
            {steps[0]?.value && steps[0].value > 0
              ? `${(((steps[steps.length - 1]?.value ?? 0) / steps[0].value) * 100).toFixed(1)}%`
              : "0%"}
          </div>
        </div>
      </div>
    </div>
  );
}
