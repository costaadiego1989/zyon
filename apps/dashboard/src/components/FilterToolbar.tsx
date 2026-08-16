import React from "react";
import { SearchInput } from "./SearchInput.js";

export interface FilterTab {
  key: string;
  label: string;
}

export interface FilterToolbarProps {
  tabs: FilterTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchWidth?: number;
  /** Extra element between tabs and search (e.g. a select dropdown) */
  extra?: React.ReactNode;
}

const TAB_STYLE_BASE: React.CSSProperties = {
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 14px",
  borderRadius: 7,
  font: "600 12px var(--sans)",
  cursor: "pointer",
  boxSizing: "border-box",
  lineHeight: 1,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--ink)",
  transition: "background 0.12s, border-color 0.12s",
};

const TAB_STYLE_ACTIVE: React.CSSProperties = {
  ...TAB_STYLE_BASE,
  background: "var(--accent-dark)",
  borderColor: "var(--accent-dark)",
  color: "#fff",
};

export function FilterToolbar({
  tabs,
  activeTab,
  onTabChange,
  search,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  searchWidth = 260,
  extra,
}: FilterToolbarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 22px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            style={activeTab === tab.key ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE}
          >
            {tab.label}
          </button>
        ))}
        {extra}
      </div>
      {onSearchChange !== undefined && search !== undefined && (
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          width={searchWidth}
        />
      )}
    </div>
  );
}

/** Styled select that matches FilterToolbar button height */
export function FilterSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{
        height: 32,
        padding: "0 26px 0 12px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        font: "600 12px var(--sans)",
        color: "var(--ink)",
        background: "var(--bg)",
        cursor: "pointer",
        outline: "none",
        boxSizing: "border-box",
        WebkitAppearance: "none",
        appearance: "none",
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
      }}
    >
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
