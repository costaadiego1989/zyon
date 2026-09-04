import React from "react";
import { X } from "lucide-react";

export interface ModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Side Panel Modal — slides in from the right.
 * Standard creation/edit modal for the dashboard.
 */
export function Modal({ isOpen, title, subtitle, eyebrow, onClose, children, footer }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          height: "100%",
          background: "var(--surface-2)",
          borderLeft: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "24px 28px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <div>
            {eyebrow && (
              <div style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-brand)", textTransform: "uppercase", marginBottom: 6 }}>
                {eyebrow}
              </div>
            )}
            <h2 style={{ font: "600 20px var(--font-serif)", color: "var(--color-text)", margin: 0, letterSpacing: "-0.01em" }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", margin: "6px 0 0" }}>{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-text-muted)",
              flexShrink: 0,
              transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--color-text)"; e.currentTarget.style.borderColor = "var(--color-border-strong)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--color-text-muted)"; e.currentTarget.style.borderColor = "var(--color-border)"; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "28px",
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: "16px 28px",
              borderTop: "1px solid var(--color-border)",
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              flexShrink: 0,
              background: "var(--surface-1)",
            }}
          >
            {footer}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
