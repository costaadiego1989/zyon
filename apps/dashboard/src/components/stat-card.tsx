import React, { type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type StatCardProps = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  trend?: { direction: "up" | "down" | "flat"; text: string };
  hero?: boolean;
};

export function StatCard({ icon: Icon, value, label, trend, hero }: StatCardProps) {
  return (
    <article className={hero ? "metric metric-hero" : "metric"}>
      <Icon size={18} aria-hidden />
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
      {trend ? (
        <span className={`metric-trend metric-trend--${trend.direction}`}>
          {trend.text}
        </span>
      ) : null}
    </article>
  );
}

export function StatCardGrid({ children }: { children: ReactNode }) {
  return <div className="metrics">{children}</div>;
}
