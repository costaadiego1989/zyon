import React from "react";
import { Inbox, type LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "48px 24px",
      textAlign: "center",
      gap: 12,
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "var(--color-brand-subtle, rgba(15,118,110,0.08))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <Icon size={24} style={{ color: "var(--color-brand, #0f766e)" }} />
      </div>
      <h3 style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", margin: 0 }}>{title}</h3>
      {description ? (
        <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", margin: 0, maxWidth: 320, lineHeight: 1.5 }}>{description}</p>
      ) : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}
