"use client";

import { useEffect, useState } from "react";
import { useWidgetConfig } from "@/lib/widget-config";

interface SupportFABProps {
  open: boolean;
  onToggle: () => void;
}

export default function SupportFAB({ open, onToggle }: SupportFABProps) {
  const { config, loading } = useWidgetConfig();
  const [showTooltip, setShowTooltip] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);

  // Derive settings from widget config with fallback defaults
  const position = config?.position ?? "bottom_right";
  const fabColor = config?.fabColor ?? "var(--aacp-accent, #0f766e)";
  const inviteText = config?.inviteText ?? "Precisa de ajuda?";
  const initialDelay = (config?.initialDelaySeconds ?? 0) * 1000;
  const startMinimized = config?.startMinimized ?? true;

  // Position mapping
  const positionStyles: Record<string, { bottom?: string; top?: string; left?: string; right?: string }> = {
    bottom_right: { bottom: "16px", right: "16px" },
    bottom_left: { bottom: "16px", left: "16px" },
    top_right: { top: "16px", right: "16px" },
    top_left: { top: "16px", left: "16px" },
  };
  const posStyle = positionStyles[position] ?? positionStyles.bottom_right;

  // Tooltip position (near FAB)
  const tooltipPositionStyles: Record<string, { bottom?: string; top?: string; left?: string; right?: string }> = {
    bottom_right: { bottom: "72px", right: "16px" },
    bottom_left: { bottom: "72px", left: "16px" },
    top_right: { top: "72px", right: "16px" },
    top_left: { top: "72px", left: "16px" },
  };
  const tooltipPos = tooltipPositionStyles[position] ?? tooltipPositionStyles.bottom_right;

  // Respect initialDelaySeconds: show FAB after delay
  useEffect(() => {
    if (initialDelay <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), initialDelay);
    return () => clearTimeout(timer);
  }, [initialDelay]);

  // Trigger scale-in animation once visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setMounted(true));
    }
  }, [visible]);

  // Show tooltip for 5 seconds after FAB appears
  useEffect(() => {
    if (!visible || !startMinimized) return;
    setShowTooltip(true);
    const timer = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(timer);
  }, [visible, startMinimized]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes fabScaleIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes tooltipFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={fabColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span style={{ fontSize: "12px", color: "var(--aacp-fg, #f5f5f7)", fontWeight: 500 }}>
            {inviteText}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowTooltip(false); }}
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
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
          transition: "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, background 0.15s ease",
        }}
      >
        {/* Cart badge */}
        {showCartBadge && !open && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#ef4444",
              border: "2px solid var(--aacp-bg, #08080c)",
            }}
          />
        )}
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
        )}
      </button>
    </>
  );
}
