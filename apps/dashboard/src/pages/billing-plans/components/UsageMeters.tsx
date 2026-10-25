import React from "react";

export interface UsageMeter {
  label: string;
  current: number | null;
  limit: number | null;
  percentage: number;
}

interface UsageMetersProps {
  meters: UsageMeter[];
}

function getBarColor(percentage: number): string {
  if (percentage >= 100) return "var(--color-error)";
  if (percentage >= 80) return "var(--color-warning)";
  return "var(--color-brand)";
}

function formatValue(value: number | null, limit: number | null): string {
  if (value === null || value === undefined) return "–";
  const current = value.toLocaleString("pt-BR");
  if (limit === null || limit === undefined || limit < 0) return `${current} / Ilimitado`;
  return `${current} / ${limit.toLocaleString("pt-BR")}`;
}

export function UsageMeters({ meters }: UsageMetersProps) {
  return (
    <div
      style={{
        padding: "24px",
        borderRadius: 14,
        border: "1px solid var(--color-border)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div>
        <div
          style={{
            font: "600 10.5px var(--font-mono)",
            letterSpacing: "0.06em",
            color: "var(--color-text-faint)",
            marginBottom: 4,
          }}
        >
          USO DO PERÍODO
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {meters.map((meter) => (
          <div key={meter.label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>
                {meter.label}
              </span>
              <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
                {formatValue(meter.current, meter.limit)}
              </span>
            </div>
            <div
              style={{
                width: "100%",
                height: 6,
                borderRadius: 3,
                background: "var(--surface-1)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, meter.percentage)}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: getBarColor(meter.percentage),
                  transition: "width 400ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
