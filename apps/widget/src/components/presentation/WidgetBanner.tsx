import React, { useEffect, useState } from "react";

export interface WidgetBannerProps {
  inviteText: string;
  ctaLabel: string;
  onClick: () => void;
  onDismiss: () => void;
  delayMs?: number;
}

export const WidgetBanner: React.FC<WidgetBannerProps> = ({
  inviteText,
  ctaLabel,
  onClick,
  onDismiss,
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

  return (
    <div
      className="zyon-presentation-banner"
      role="region"
      aria-label="Convite do agente"
      style={{
        position: "fixed",
        left: "0px",
        right: "0px",
        bottom: "0px",
        height: "56px",
        background: "#111827",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: "12px",
        zIndex: 2147483600,
        boxShadow: "0 -8px 24px rgba(0,0,0,0.18)"
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #6366f1, #ec4899)",
          flexShrink: 0
        }}
      />
      <div style={{ flex: 1, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {inviteText}
      </div>
      <button
        type="button"
        className="zyon-presentation-banner__cta"
        onClick={onClick}
        style={{
          background: "#ffffff",
          color: "#111827",
          border: "none",
          borderRadius: "8px",
          padding: "8px 14px",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        {ctaLabel}
      </button>
      <button
        type="button"
        className="zyon-presentation-banner__dismiss"
        aria-label="Fechar"
        onClick={onDismiss}
        style={{
          background: "transparent",
          color: "#ffffff",
          border: "none",
          fontSize: "20px",
          lineHeight: 1,
          cursor: "pointer",
          padding: "0 4px"
        }}
      >
        ×
      </button>
    </div>
  );
};
