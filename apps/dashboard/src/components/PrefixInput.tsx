import React from "react";

export interface PrefixInputProps {
  prefix: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  label?: string;
  style?: React.CSSProperties;
}

export function PrefixInput({ prefix, value, onChange, placeholder, error, label, style }: PrefixInputProps) {
  return (
    <label style={style}>
      {label && <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{label}</span>}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        <span style={{ padding: "0 10px", borderRadius: "7px 0 0 7px", border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`, borderRight: "none", background: "oklch(20% 0.004 145)", color: "var(--muted)", font: "12.5px var(--mono)", display: "flex", alignItems: "center", flexShrink: 0 }}>{prefix}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, padding: "7px 10px", borderRadius: "0 7px 7px 0", border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)", outline: "none" }}
        />
      </div>
      {error && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{error}</span>}
    </label>
  );
}
