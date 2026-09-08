import React from "react";

/**
 * Standardized empty state placeholder for dashboard panels.
 *
 * Visual contract:
 *  - dashed 1px border, radius 10
 *  - surface-1 background
 *  - 32px vertical / 16px horizontal padding
 *  - centered icon (24px, color-text-faint) over a 13px message
 *
 * The optional `action` slot lets call sites wire a CTA button without
 * re-implementing the dashed-border container.
 */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div
      style={{
        border: "1px dashed var(--color-border)",
        borderRadius: 10,
        padding: "32px 16px",
        background: "var(--surface-1)",
        textAlign: "center",
        color: "var(--color-text-faint)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
      }}
    >
      {icon ? <div style={{ display: "flex" }}>{icon}</div> : null}
      {title ? (
        <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text-secondary)" }}>
          {title}
        </div>
      ) : null}
      <p
        style={{
          margin: 0,
          font: "13px var(--font-sans)",
          color: "var(--color-text-faint)",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
