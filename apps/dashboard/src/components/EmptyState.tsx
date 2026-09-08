import React, { type ElementType, type ReactNode } from "react";

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
  icon?: ReactNode | ElementType;
  title?: string;
  message?: string;
  description?: string;
  action?: ReactNode;
}

function renderIcon(icon: EmptyStateProps["icon"]) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const Icon = icon as ElementType;
  return <Icon size={24} strokeWidth={1.8} />;
}

export function EmptyState({ icon, title, message, description, action }: EmptyStateProps) {
  const body = description ?? message;

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
      {icon ? <div style={{ display: "flex" }}>{renderIcon(icon)}</div> : null}
      {title ? (
        <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text-secondary)" }}>
          {title}
        </div>
      ) : null}
      {body ? (
        <p
          style={{
            margin: 0,
            font: "13px var(--font-sans)",
            color: "var(--color-text-faint)",
            maxWidth: 360,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
      ) : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
