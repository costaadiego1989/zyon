import React, { type ReactNode, useEffect, useState } from "react";

export type StatCardProps = {
  label: string;
  value: string | number;
  prefix?: string;
  suffix?: string;
  trend?: number;
  icon?: ReactNode;
  accent?: string;
  sparkline?: number[];
};

function AnimatedCounter({ value, duration = 800 }: { value: string | number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState<string | number>(value);

  useEffect(() => {
    if (typeof value === "string") {
      setDisplayValue(value);
      return;
    }

    const numValue = typeof value === "number" ? value : 0;
    let currentValue = 0;
    const increment = numValue / (duration / 16);
    const interval = setInterval(() => {
      currentValue += increment;
      if (currentValue >= numValue) {
        setDisplayValue(Math.floor(numValue));
        clearInterval(interval);
      } else {
        setDisplayValue(Math.floor(currentValue));
      }
    }, 16);

    return () => clearInterval(interval);
  }, [value, duration]);

  return displayValue;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = data.length * 2;
  const height = 20;
  const points = data
    .map((v, i) => `${(i * width) / (data.length - 1)},${height - ((v - min) / range) * height * 0.8}`)
    .join(" ");

  return (
    <svg width={width} height={height} style={{ display: "block" }} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      <polyline points={points} fill={`currentColor`} opacity="0.08" />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  prefix,
  suffix,
  trend,
  icon,
  accent,
  sparkline,
}: StatCardProps) {
  const trendPositive = trend !== undefined && trend >= 0;
  const trendBg = trendPositive ? "var(--good-soft)" : "var(--danger-soft)";
  const trendFg = trendPositive ? "var(--good)" : "var(--danger)";

  return (
    <article
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
        transition: "all 200ms cubic-bezier(0.16,1,0.3,1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "oklch(20% 0.006 145)";
        (e.currentTarget as HTMLElement).style.borderColor = "oklch(35% 0.008 145)";
        (e.currentTarget as HTMLElement).style.boxShadow =
          "0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 oklch(30% 0.008 145 / 0.5)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "var(--card)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      {/* Glass overlay effect when hovering */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "linear-gradient(135deg, oklch(30% 0.008 145 / 0) 0%, oklch(30% 0.008 145 / 0.1) 100%)",
          opacity: 0,
          transition: "opacity 200ms",
          pointerEvents: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, position: "relative", zIndex: 1 }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
            fontFamily: "var(--sans)",
          }}
        >
          {label}
        </span>
        {icon ? (
          <span style={{ color: accent ?? "var(--accent)", display: "flex", alignItems: "center", fontSize: 16 }}>
            {icon}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
        {prefix ? (
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            {prefix}
          </span>
        ) : null}
        <span
          style={{
            fontSize: 28,
            fontFamily: "var(--mono)",
            fontWeight: 700,
            color: accent ?? "var(--ink)",
            letterSpacing: -0.5,
            lineHeight: 1.1,
          }}
        >
          <AnimatedCounter value={value} />
        </span>
        {suffix ? (
          <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            {suffix}
          </span>
        ) : null}
      </div>

      {sparkline && sparkline.length > 1 && (
        <div style={{ color: accent ?? "var(--accent)", opacity: 0.6, position: "relative", zIndex: 1 }}>
          <MiniSparkline data={sparkline} />
        </div>
      )}

      {trend !== undefined ? (
        <span
          style={{
            alignSelf: "flex-start",
            background: trendBg,
            color: trendFg,
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontFamily: "var(--mono)",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            position: "relative",
            zIndex: 1,
          }}
        >
          <span aria-hidden style={{ fontSize: 12 }}>
            {trendPositive ? "↑" : "↓"}
          </span>
          {Math.abs(trend).toFixed(1)}%
        </span>
      ) : null}
    </article>
  );
}
