import React, { type ReactNode } from "react";

export type StatCardProps = {
  label: string;
  value: string | number;
  prefix?: string;
  suffix?: string;
  trend?: number;
  icon?: ReactNode;
  accent?: string;
};

export function StatCard({ label, value, prefix, suffix, trend, icon, accent }: StatCardProps) {
  const trendPositive = trend !== undefined && trend >= 0;
  const trendBg = trendPositive ? "var(--good-soft)" : "var(--danger-soft)";
  const trendFg = trendPositive ? "var(--good)" : "var(--danger)";

  return (
    <article
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>
          {label}
        </span>
        {icon ? (
          <span style={{ color: accent ?? "var(--accent)", display: "flex", alignItems: "center" }}>{icon}</span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap" }}>
        {prefix ? (
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>{prefix}</span>
        ) : null}
        <span
          style={{
            fontSize: 24,
            fontFamily: "var(--mono)",
            fontWeight: 600,
            color: accent ?? "var(--ink)",
            letterSpacing: -0.5,
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
        {suffix ? (
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>{suffix}</span>
        ) : null}
      </div>
      {trend !== undefined ? (
        <span
          style={{
            alignSelf: "flex-start",
            background: trendBg,
            color: trendFg,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 11,
            fontFamily: "var(--mono)",
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span aria-hidden>{trendPositive ? "↑" : "↓"}</span>
          {Math.abs(trend).toFixed(1)}%
        </span>
      ) : null}
    </article>
  );
}
