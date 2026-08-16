import React from "react";

export interface ModalButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  loading?: boolean;
  children: React.ReactNode;
}

export function ModalButton({
  variant = "secondary",
  loading = false,
  disabled,
  children,
  style,
  ...props
}: ModalButtonProps) {
  const isPrimary = variant === "primary";

  return (
    <button
      type="button"
      disabled={disabled || loading}
      style={{
        padding: "11px 24px",
        height: 44,
        borderRadius: 8,
        border: `1px solid ${isPrimary ? "var(--accent-dark)" : "var(--border)"}`,
        background: isPrimary ? "var(--accent-dark)" : "var(--card)",
        color: isPrimary ? "white" : "var(--ink)",
        font: "600 13px var(--sans)",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.6 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        transition: "opacity 0.2s",
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
