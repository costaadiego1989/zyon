import React, { useEffect, useState } from "react";
import type { Position } from "./mode-resolver.js";
import { resolvePositionStyles } from "./mode-resolver.js";

export interface WidgetMiniCardProps {
  inviteText: string;
  onClick: () => void;
  onDismiss: () => void;
  position?: Position;
  delayMs?: number;
}

export const WidgetMiniCard: React.FC<WidgetMiniCardProps> = ({
  inviteText,
  onClick,
  onDismiss,
  position = "bottom_right",
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="zyon-presentation-mini-card"
      style={{
        ...positionStyle,
        width: "240px",
        height: "64px",
        background: "#ffffff",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: "12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: "10px",
        cursor: "pointer",
        zIndex: 2147483600
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #ec4899)",
          flexShrink: 0
        }}
      />
      <div style={{ flex: 1, fontSize: "13px", color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {inviteText}
      </div>
      <button
        type="button"
        aria-label="Fechar"
        className="zyon-presentation-mini-card__dismiss"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        style={{
          width: "24px",
          height: "24px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderRadius: "6px",
          color: "#6b7280",
          fontSize: "16px",
          lineHeight: 1
        }}
      >
        ×
      </button>
    </div>
  );
};
