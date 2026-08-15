import React from "react";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}

export function SearchInput({ value, onChange, placeholder = "Buscar...", width = 260 }: SearchInputProps) {
  return (
    <div style={{ position: "relative", height: 32 }}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--faint)" }}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width,
          height: 32,
          padding: "0 12px 0 30px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          font: "13px var(--sans)",
          color: "var(--ink)",
          outline: "none",
          background: "var(--bg)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
