import React from "react";
import { STATUS_LABELS } from "../utils.js";

type OrderStatus =
  | "pending"
  | "confirmed"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "approved"
  | "cancelled"
  | "failed"
  | "refunded"
  | "returned"
  | string;

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

function getLabel(status: OrderStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function getStyles(status: OrderStatus): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "pending":
    case "processing":
      return { bg: "var(--color-warning-bg)", fg: "var(--color-warning)", dot: "var(--color-warning)" };
    case "confirmed":
      return { bg: "var(--color-info-bg)", fg: "var(--color-info)", dot: "var(--color-info)" };
    case "shipped":
      return { bg: "oklch(24% 0.06 290)", fg: "oklch(80% 0.14 290)", dot: "oklch(70% 0.16 290)" };
    case "delivered":
    case "approved":
    case "paid":
      return { bg: "var(--color-success-bg)", fg: "var(--color-success)", dot: "var(--color-success)" };
    case "cancelled":
    case "failed":
      return { bg: "var(--color-error-bg)", fg: "var(--color-error)", dot: "var(--color-error)" };
    case "refunded":
    case "returned":
      return { bg: "var(--color-surface-raised)", fg: "var(--color-text-muted)", dot: "var(--color-text-muted)" };
    default:
      return { bg: "var(--color-surface-raised)", fg: "var(--color-text)", dot: "var(--color-text-faint)" };
  }
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const { bg, fg, dot } = getStyles(status);
  const label = getLabel(status);

  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 9px",
        borderRadius: 99,
        background: bg,
        color: fg,
        font: "600 11px var(--font-sans)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dot,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
