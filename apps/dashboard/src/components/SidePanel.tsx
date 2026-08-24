import React from "react";
import { X, Edit } from "lucide-react";

export interface SidePanelProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SidePanel({ isOpen, title, onClose, children }: SidePanelProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.2)",
          zIndex: 999,
          animation: "fadeIn 0.15s ease-out",
        }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: "420px",
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--color-border)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.08)",
          animation: "slideInRight 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <h2 style={{
            margin: 0,
            font: "600 16px var(--font-sans)",
            color: "var(--color-text)",
          }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "4px",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        {/* Content */}
        <div style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 24px",
        }}>
          {children}
        </div>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

export interface EditButtonProps {
  onClick: () => void;
  size?: number;
}

export function EditButton({ onClick, size = 16 }: EditButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: "4px 8px",
        color: "var(--color-brand)",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        font: "12px var(--font-sans)",
        transition: "opacity 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      title="Editar"
    >
      <Edit size={size} />
    </button>
  );
}
