import React from "react";

/**
 * Self-contained toggle switch — slim pill shape.
 * 36×20 track, 16px thumb. iOS-style.
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
        width: 36,
        height: 20,
        minHeight: 20,
        maxHeight: 20,
        borderRadius: 10,
        border: "none",
        padding: 2,
        background: checked ? "var(--accent, #0f766e)" : "oklch(30% 0.005 145)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        transition: "background 0.2s ease",
        opacity: disabled ? 0.45 : 1,
        outline: "none",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 0.5px 2px rgba(0,0,0,0.3)",
          transition: "transform 0.15s ease",
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}
