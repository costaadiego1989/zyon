import React, { type ReactNode } from "react";

/**
 * Standardized section header for dashboard panels.
 *
 * PRIMARY (with subtitle):
 *   TITLE 18px       ← accent color (green)
 *   SUBTITLE 13px    ← ink/white
 *
 * SECONDARY (title only):
 *   TITLE 18px       ← accent color (green)
 */

export interface SectionHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  /** "primary" = title + subtitle. "secondary" = title only. */
  variant?: "primary" | "secondary";
  /** Right-side slot (badges, buttons) */
  trailing?: ReactNode;
}

export function SectionHeader({
  title,
  subtitle,
  variant = "primary",
  trailing,
}: SectionHeaderProps) {
  if (variant === "secondary") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ font: "600 14px var(--sans)", color: "var(--accent)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        {trailing ?? null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h2 style={{ font: "600 14px var(--sans)", color: "var(--accent)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        {subtitle ? (
          <p style={{ font: "13px var(--sans)", color: "var(--ink)", margin: 0, opacity: 0.85 }}>{subtitle}</p>
        ) : null}
      </div>
      {trailing ?? null}
    </div>
  );
}
