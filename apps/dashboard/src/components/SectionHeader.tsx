import React, { type ReactNode } from "react";

/**
 * Standardized section header for dashboard panels.
 *
 * PRIMARY (with subtitle):
 *   TITLE 16px       ← accent color (green)
 *   SUBTITLE 13px    ← secondary text
 *
 * SECONDARY (title only):
 *   TITLE 14px       ← accent color (green)
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
  icon,
  title,
  subtitle,
  variant = "primary",
  trailing,
}: SectionHeaderProps) {
  if (variant === "secondary") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ color: "var(--color-brand)", display: "flex" }}>{icon}</span>}
          <h2 style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        </div>
        {trailing ?? null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span style={{ color: "var(--color-brand)", display: "flex" }}>{icon}</span>}
          <h2 style={{ font: "600 16px var(--font-sans)", color: "var(--color-brand)", margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        </div>
        {subtitle ? (
          <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>{subtitle}</p>
        ) : null}
      </div>
      {trailing ?? null}
    </div>
  );
}
