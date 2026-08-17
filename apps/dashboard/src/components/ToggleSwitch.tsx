import React from "react";

/**
 * Self-contained toggle switch with inline styles.
 * Slim iOS-style toggle — 40×22px track, 18px thumb.
 */
export function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
  id,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 12,
        border: "none",
        padding: 2,
        background: checked ? "var(--accent, #0f766e)" : "oklch(35% 0.01 145)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        transition: "background 0.2s ease",
        opacity: disabled ? 0.45 : 1,
        outline: "none",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          transition: "transform 0.2s ease",
          transform: checked ? "translateX(18px)" : "translateX(0)",
        }}
      />
    </button>
  );
}
