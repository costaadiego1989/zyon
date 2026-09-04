import React from "react";

export interface PrefixInputProps {
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  label?: string;
  style?: React.CSSProperties;
  inputMode?: "text" | "decimal" | "numeric";
}

export function PrefixInput({ prefix, value, onChange, placeholder, error, label, style, inputMode }: PrefixInputProps) {
  return (
    <label style={style}>
      {label && <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>{label}</span>}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        <span style={{ padding: "0 10px", borderRadius: "7px 0 0 7px", border: `1px solid ${error ? "var(--color-error)" : "var(--color-border)"}`, borderRight: "none", background: "oklch(20% 0.004 145)", color: "var(--color-text-muted)", font: "12.5px var(--font-mono)", display: "flex", alignItems: "center", flexShrink: 0 }}>{prefix}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          style={{ flex: 1, padding: "7px 10px", borderRadius: "0 7px 7px 0", border: `1px solid ${error ? "var(--color-error)" : "var(--color-border)"}`, background: "var(--surface-1)", color: "var(--color-text)", font: "12.5px var(--font-mono)", outline: "none" }}
        />
      </div>
      {error && <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{error}</span>}
    </label>
  );
}
