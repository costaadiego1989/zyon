"use client";

import { useEffect, useState } from "react";

interface SupportFABProps {
  open: boolean;
  onToggle: () => void;
}

export default function SupportFAB({ open, onToggle }: SupportFABProps) {
  const [showTooltip, setShowTooltip] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger scale-in animation
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(timer);
  }, []);

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
            bottom: "72px",
            right: "16px",
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span style={{ fontSize: "12px", color: "var(--aacp-fg, #f5f5f7)", fontWeight: 500 }}>
            Precisa de ajuda?
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
          bottom: "16px",
          right: "16px",
          zIndex: 9999,
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "none",
          background: "var(--aacp-accent, #0f766e)",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3), 0 0 0 3px color-mix(in srgb, var(--aacp-accent, #0f766e) 20%, transparent)",
          transform: mounted ? "scale(1)" : "scale(0)",
          opacity: mounted ? 1 : 0,
          transition: "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease, background 0.15s ease",
        }}
      >
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
