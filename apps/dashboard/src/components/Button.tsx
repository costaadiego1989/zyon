import React from "react";
import { ArrowRight, Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  arrow = false,
  loading = false,
  fullWidth = false,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const classes = [
    "zyn-btn",
    `zyn-btn--${variant}`,
    `zyn-btn--${size}`,
    fullWidth ? "zyn-btn--full" : "",
    loading ? "zyn-btn--loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className="zyn-btn__label">{loading && <Loader2 size={14} className="zyn-btn__spinner" aria-hidden="true" />}{children}</span>
      {arrow && !loading && <ArrowRight size={14} className="zyn-btn__arrow" />}
    </button>
  );
}
