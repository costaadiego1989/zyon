import React, { type ReactNode } from "react";

/**
 * Standardized section header for dashboard panels.
 *
 * PRIMARY (with subtitle):
 *   [ICON]
 *   TITLE          ← accent color (green)
 *   SUBTITLE       ← ink/white
 *
 * SECONDARY (no subtitle):
 *   [ICON] TITLE   ← accent color, inline
 */

export interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** "primary" = stacked icon/title/subtitle. "secondary" = inline icon + title only. */
  variant?: "primary" | "secondary";
  /** Right-side slot (badges, buttons) */
  trailing?: ReactNode;
}

export function SectionHeader({
  icon,
  title,
  subtitle,
  variant = "primary",
  trailing,
}: SectionHeaderProps) {
  if (variant === "secondary") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}>{icon}</span>
          <h2 style={{ font: "600 14px var(--sans)", color: "var(--accent)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        </div>
        {trailing ?? null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center" }}>{icon}</span>
        <h2 style={{ font: "600 24px var(--sans)", color: "var(--accent)", margin: 0, letterSpacing: "-0.02em" }}>{title}</h2>
        {subtitle ? (
          <p style={{ font: "13px var(--sans)", color: "var(--ink)", margin: 0, opacity: 0.85 }}>{subtitle}</p>
        ) : null}
      </div>
      {trailing ?? null}
    </div>
  );
}
