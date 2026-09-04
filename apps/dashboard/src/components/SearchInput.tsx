import React from "react";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number | string;
}

export function SearchInput({ value, onChange, placeholder = "Buscar...", width = 260 }: SearchInputProps) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", height: 36, width: width === 9999 ? "100%" : undefined }}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ position: "absolute", left: 10, color: "var(--color-text-faint)", pointerEvents: "none" }}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: width === 9999 ? "100%" : width,
          height: 36,
          padding: "0 12px 0 32px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          font: "13px var(--font-sans)",
          color: "var(--color-text)",
          outline: "none",
          background: "var(--surface-1)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
