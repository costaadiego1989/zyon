import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button.js";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(2px)",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          padding: "24px",
          width: 380,
          maxWidth: "90vw",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: variant === "danger" ? "rgba(239, 68, 68, 0.1)" : "var(--color-brand-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <AlertTriangle size={20} style={{ color: variant === "danger" ? "#ef4444" : "var(--color-brand)" }} />
          </div>
          <div>
            <h3 style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", margin: "0 0 4px" }}>{title}</h3>
            {description && (
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>{description}</p>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              font: "600 12px var(--font-sans)",
              cursor: "pointer",
              background: variant === "danger" ? "#ef4444" : "var(--color-brand)",
              color: "#fff",
              transition: "opacity 0.15s",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
