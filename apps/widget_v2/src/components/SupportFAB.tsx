import { useEffect, useState } from "react";
import { useCheckoutStore } from "@/store/checkout-store";

interface SupportFABProps {
  open: boolean;
  onToggle: () => void;
  cartItemCount?: number;
}

export default function SupportFAB({
  open,
  onToggle,
  cartItemCount = 0,
}: SupportFABProps) {
  const brand = useCheckoutStore((s) => s.brand);
  const [showTooltip, setShowTooltip] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [badgePulse, setBadgePulse] = useState(false);

  const position = "bottom_right";
  const fabColor = brand.accentColor ?? "var(--aacp-accent, #0f766e)";
  const inviteText = "Precisa de ajuda?";
  const initialDelay = 0;
  const startMinimized = true;

  const positionStyles: Record<
    string,
    { bottom?: string; top?: string; left?: string; right?: string }
  > = {
    bottom_right: { bottom: "16px", right: "16px" },
    bottom_left: { bottom: "16px", left: "16px" },
    top_right: { top: "16px", right: "16px" },
    top_left: { top: "16px", left: "16px" },
  };
  const posStyle = positionStyles[position] ?? positionStyles.bottom_right;

  const tooltipPositionStyles: Record<
    string,
    { bottom?: string; top?: string; left?: string; right?: string }
  > = {
    bottom_right: { bottom: "72px", right: "16px" },
    bottom_left: { bottom: "72px", left: "16px" },
    top_right: { top: "72px", right: "16px" },
    top_left: { top: "72px", left: "16px" },
  };
  const tooltipPos =
    tooltipPositionStyles[position] ?? tooltipPositionStyles.bottom_right;

  useEffect(() => {
    if (initialDelay <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), initialDelay);
    return () => clearTimeout(timer);
  }, [initialDelay]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setMounted(true));
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !startMinimized) return;
    setShowTooltip(true);
    const timer = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(timer);
  }, [visible, startMinimized]);

  // Pulse badge when cart count changes
  useEffect(() => {
    if (cartItemCount > 0) {
      setBadgePulse(true);
      const timer = setTimeout(() => setBadgePulse(false), 600);
      return () => clearTimeout(timer);
    }
  }, [cartItemCount]);

  if (!visible) return null;

  const showCartBadge = cartItemCount > 0 && !open;

  return (
    <>
      <style>{`
        @keyframes fabScaleIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes tooltipFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes badgeBounce { 0% { transform: scale(0.5); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
      `}</style>

      {/* Tooltip */}
      {showTooltip && !open && (
        <div
          style={{
            position: "fixed",
            ...tooltipPos,
            zIndex: 9999,
            background: "var(--aacp-surface, #0f0f16)",
            border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
            borderRadius: "10px",
            padding: "8px 12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            animation: "tooltipFadeIn 0.3s ease both",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={fabColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span
            style={{
              fontSize: "12px",
              color: "var(--aacp-fg, #f5f5f7)",
              fontWeight: 500,
            }}
          >
            {inviteText}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip(false);
            }}
            style={{
              background: "none",
              border: "none",
              padding: "2px",
              cursor: "pointer",
              color: "var(--aacp-muted, #8b8b95)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Fechar tooltip"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* FAB Button */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={open ? "Fechar suporte" : "Abrir suporte"}
        style={{
          position: "fixed",
          ...posStyle,
          zIndex: 9999,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "none",
          background: fabColor,
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 4px 16px rgba(0,0,0,0.3), 0 0 0 3px color-mix(in srgb, ${fabColor} 20%, transparent)`,
          transform: mounted ? "scale(1)" : "scale(0)",
          opacity: mounted ? 1 : 0,
          transition:
            "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, background 0.15s ease",
        }}
      >
        {/* Cart badge */}
        {showCartBadge && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              minWidth: "18px",
              height: "18px",
              borderRadius: "9px",
              background: "#ef4444",
              border: "2px solid var(--aacp-bg, #08080c)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              fontWeight: 700,
              color: "#fff",
              padding: "0 4px",
              animation: badgePulse ? "badgeBounce 0.4s ease" : undefined,
            }}
          >
            {cartItemCount}
          </span>
        )}
        {open ? (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
        )}
      </button>
    </>
  );
}
