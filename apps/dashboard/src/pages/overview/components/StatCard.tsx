import React, { type ReactNode } from "react";
import "./stat-card.css";

export type StatCardProps = {
  label: string;
  value: string | number;
  prefix?: string;
  suffix?: string;
  trend?: number;
  icon?: ReactNode;
  accent?: string;
  sparkline?: number[];
  note?: string;
  primary?: boolean;
};

export function StatCardGroup({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return <section className={`stat-card-group${primary ? " stat-card-group--primary" : ""}`} aria-label="Indicadores">{children}</section>;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 24;
  const padding = 2;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `${padding},${height} ${points} ${width - padding},${height}`;

  return (
    <svg width={width} height={height} style={{ display: "block", width: "100%", maxWidth: 80 }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polygon points={areaPoints} fill="currentColor" opacity="0.12" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  note,
  primary = false,
}: StatCardProps) {
  const trendPositive = trend !== undefined && trend >= 0;
  const trendBg = trendPositive ? "var(--color-success-bg)" : "var(--color-error-bg)";
  const trendFg = trendPositive ? "var(--color-success)" : "var(--color-error)";

  return (
    <article
      className={`stat-card${primary ? " stat-card--primary" : ""}`}
      style={{
        "--stat-accent": accent ?? (primary ? "var(--color-brand)" : "var(--color-text)"),
      } as React.CSSProperties}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, position: "relative", zIndex: 1 }}>
        <span
          style={{
            font: "600 10px var(--font-mono)",
            color: "var(--color-text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </span>
        {icon ? (
          <span style={{ color: accent ?? "var(--color-brand)", display: "flex", alignItems: "center", fontSize: 16 }}>
            {icon}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexWrap: "wrap", position: "relative", zIndex: 1 }}>
        {prefix ? (
          <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
            {prefix}
          </span>
        ) : null}
        <strong className="stat-card__value">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</strong>
        {suffix ? (
          <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
            {suffix}
          </span>
        ) : null}
      </div>

      {note ? <span className="stat-card__note">{note}</span> : null}

      {sparkline && sparkline.length > 1 && (
        <div style={{ color: accent ?? "var(--color-brand)", opacity: 0.6, position: "relative", zIndex: 1 }}>
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
            borderRadius: "var(--radius-full)",
            font: "700 11px var(--font-mono)",
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
