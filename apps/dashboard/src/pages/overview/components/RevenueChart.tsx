import React, { useMemo } from "react";
import uPlot from "uplot";
import { ChartWrapper } from "./ChartWrapper.js";

export type RevenueChartProps = {
  data: Array<{ date: string; value: number }>;
  type?: "line" | "bar";
  label?: string;
  color?: string;
  valueFormat?: "currency" | "percent" | "number";
};

export function RevenueChart({
  data,
  type = "line",
  label = "Receita",
  color = "var(--color-brand)",
  valueFormat = "number",
}: RevenueChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          padding: "32px 16px",
          textAlign: "center",
          color: "var(--color-text-muted)",
          fontSize: 13,
          background: "var(--surface-2)",
          borderRadius: 14,
          border: "1px solid var(--color-border)",
        }}
      >
        Sem dados no período
      </div>
    );
  }

  const latestValue = data[data.length - 1]?.value ?? 0;

  const formatValue = (val: number): string => {
    if (valueFormat === "currency") {
      return `R$ ${val.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
    }
    if (valueFormat === "percent") {
      return `${val.toFixed(1)}%`;
    }
    return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  };

  const aligned = useMemo((): uPlot.AlignedData => {
    const timestamps = data.map((d) => Math.floor(new Date(d.date).getTime() / 1000));
    const values = data.map((d) => d.value);
    return [timestamps, values];
  }, [data]);

  const options = useMemo((): uPlot.Options => {
    const series: uPlot.Series[] = [
      {},
      {
        label,
        stroke: color,
        fill: type === "line" ? "oklch(74% 0.19 149 / 0.06)" : color + "22",
        width: 2,
        paths: type === "bar" ? (uPlot as any).paths?.bars?.({ size: [0.6] }) : undefined,
      },
    ];

    return {
      width: 400,
      height: 200,
      series,
      axes: [
        {
          stroke: "oklch(50% 0.006 145)",
          grid: { stroke: "oklch(22% 0.006 145)", width: 1 },
          ticks: { stroke: "oklch(22% 0.006 145)", width: 1 },
        },
        {
          stroke: "oklch(50% 0.006 145)",
          grid: { stroke: "oklch(22% 0.006 145)", width: 1 },
          ticks: { stroke: "oklch(22% 0.006 145)", width: 1 },
          size: 56,
          values: (_u, vals) =>
            vals.map((v) => (typeof v === "number" ? formatValue(v) : "")),
        },
      ],
      cursor: {
        show: true,
        drag: { setScale: false },
        points: { show: true },
      },
      legend: { show: false },
    };
  }, [label, color, type, valueFormat]);

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header with title + current value */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              color: "var(--color-brand)",
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
              letterSpacing: -0.3,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              marginTop: 2,
              fontFamily: "var(--font-sans)",
            }}
          >
            {data.length} pontos · período atual
          </div>
        </div>
        <div
          style={{
            fontSize: 22,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: "var(--color-text)",
            letterSpacing: -0.5,
          }}
        >
          {formatValue(latestValue)}
        </div>
      </div>

      {/* Chart */}
      <ChartWrapper options={options} data={aligned} style={{ width: "100%", height: 200 }} />
    </div>
  );
}
