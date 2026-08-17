import React from "react";

/**
 * Self-contained toggle switch with inline styles.
 * Does not depend on external CSS — usable in any page.
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
        width: 38,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 3,
        background: checked ? "var(--accent, #0f766e)" : "var(--border, #333)",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        overflow: "hidden",
        transition: "background 0.2s ease",
        opacity: disabled ? 0.45 : 1,
        position: "relative",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          transition: "transform 0.2s ease",
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}
