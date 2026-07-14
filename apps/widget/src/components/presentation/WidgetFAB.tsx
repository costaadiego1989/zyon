import React, { useEffect, useState } from "react";
import type { Position } from "./mode-resolver.js";
import { resolvePositionStyles } from "./mode-resolver.js";

export interface WidgetFABProps {
  color: string;
  position: Position;
  onClick: () => void;
  badgeCount?: number;
  showCartBadge?: boolean;
  delayMs?: number;
}

export const WidgetFAB: React.FC<WidgetFABProps> = ({
  color,
  position,
  onClick,
  badgeCount = 0,
  showCartBadge = true,
  delayMs = 0
}) => {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  const positionStyle = resolvePositionStyles(position);
  const showBadge = showCartBadge && badgeCount > 0;

  return (
    <button
      type="button"
      className="zyon-presentation-fab zyon-presentation-fab--pulse"
      aria-label="Abrir checkout"
      onClick={onClick}
      style={{
        ...positionStyle,
        width: "56px",
        height: "56px",
        borderRadius: "50%",
        backgroundColor: color,
        color: "#ffffff",
        border: "none",
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        zIndex: 2147483600
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {showBadge && (
        <span
          className="zyon-presentation-fab__badge"
          style={{
            position: "absolute",
            top: "-4px",
            right: "-4px",
            minWidth: "20px",
            height: "20px",
            borderRadius: "10px",
            background: "#ef4444",
            color: "#ffffff",
            fontSize: "11px",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 6px",
            boxShadow: "0 0 0 2px #ffffff"
          }}
        >
          {badgeCount}
        </span>
      )}
    </button>
  );
};
