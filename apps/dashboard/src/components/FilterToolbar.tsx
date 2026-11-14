import React from "react";
import { TabBar } from "./TabBar.js";
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
    <div className="filter-toolbar">
      <div className="filter-toolbar__controls">
        {tabs.length > 0 && <TabBar tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} role="group" label="Filtrar resultados" />}
        {extra ? <div className="filter-toolbar__extra">{extra}</div> : null}
      </div>
      {onSearchChange !== undefined && search !== undefined && (
        <div className="filter-toolbar__search">
          <SearchInput
            value={search}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            width={searchWidth}
          />
        </div>
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
  width?: number | string;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}) {


  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label={props.ariaLabel ?? props.placeholder ?? "Filtrar resultados"}
      className={["ui-filter-select", props.className].filter(Boolean).join(" ")}
      style={{ width: props.width ?? 200 }}
    >
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
