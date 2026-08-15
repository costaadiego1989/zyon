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
      }}
    >
      {title && (
        <h4 style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", margin: 0 }}>
          {title}
        </h4>
      )}

      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
        {steps.map((step, i) => {
          const fill = step.color ?? "var(--accent)";
          const prevValue = i > 0 ? steps[i - 1].value : null;
          const dropRate = prevValue && prevValue > 0
            ? ((prevValue - (step.value ?? 0)) / prevValue) * 100
            : null;
          const convRate = prevValue && prevValue > 0
            ? ((step.value ?? 0) / prevValue) * 100
            : null;
          const barHeight = Math.max(20, ((step.value ?? 0) / max) * 100);

          return (
            <React.Fragment key={step.label}>
              {i > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 6px",
                    minWidth: 36,
                  }}
                >
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none" style={{ opacity: 0.5 }}>
                    <path d="M4 8h12M12 4l4 4-4 4" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {convRate !== null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "var(--mono)",
                        fontWeight: 700,
                        color: convRate >= 50 ? "var(--good)" : convRate >= 20 ? "var(--warn)" : "var(--danger)",
                        marginTop: 2,
                      }}
                    >
                      {convRate.toFixed(0)}%
                    </span>
                  )}
                  {dropRate !== null && dropRate > 0 && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "var(--mono)",
                        color: "var(--muted)",
                        marginTop: 1,
                      }}
                    >
                      −{dropRate.toFixed(0)}%
                    </span>
                  )}
                </div>
              )}

              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: 120,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: "70%",
                      height: `${barHeight}%`,
                      minHeight: 24,
                      background: fill,
                      opacity: 0.9,
                      borderRadius: "8px 8px 4px 4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "height 300ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontFamily: "var(--mono)",
                        fontWeight: 700,
                        color: "#fff",
                        textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                      }}
                    >
                      {(step.value ?? 0).toLocaleString("pt-BR")}
                    </span>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--ink)",
                    textAlign: "center",
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {step.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--muted)",
          fontFamily: "var(--mono)",
        }}
      >
        <span>Entrada: {(steps[0]?.value ?? 0).toLocaleString("pt-BR")}</span>
        <span>Saída: {(steps[steps.length - 1]?.value ?? 0).toLocaleString("pt-BR")}</span>
        <span>
          Conversão total:{" "}
          <strong style={{ color: "var(--ink)" }}>
            {steps[0]?.value && steps[0].value > 0
              ? `${(((steps[steps.length - 1]?.value ?? 0) / steps[0].value) * 100).toFixed(1)}%`
              : "0%"}
          </strong>
        </span>
      </div>
    </div>
  );
}
