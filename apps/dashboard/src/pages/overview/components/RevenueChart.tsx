import React, { useMemo } from "react";
import uPlot from "uplot";
import { ChartWrapper } from "./ChartWrapper.js";

export type RevenueChartProps = {
  data: Array<{ date: string; value: number }>;
  type?: "line" | "bar";
  label?: string;
  color?: string;
};

export function RevenueChart({ data, type = "line", label = "Receita", color = "var(--accent)" }: RevenueChartProps) {
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
        fill: type === "bar" ? color + "33" : undefined,
        width: 2,
        paths: type === "bar" ? (uPlot as any).paths?.bars?.({ size: [0.6] }) : undefined,
      },
    ];
    return {
      width: 400,
      height: 200,
      series,
      axes: [
        { stroke: "var(--muted)", grid: { stroke: "var(--border)", width: 1 } },
        { stroke: "var(--muted)", grid: { stroke: "var(--border)", width: 1 }, size: 50 },
      ],
      cursor: { show: true },
      legend: { show: false },
    };
  }, [label, color, type]);

  if (data.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
        Sem dados no período
      </div>
    );
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 12 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <ChartWrapper options={options} data={aligned} style={{ width: "100%", height: 200 }} />
    </div>
  );
}
