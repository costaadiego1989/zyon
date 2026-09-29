import React from "react";
import { Search, X } from "lucide-react";
export interface SearchInputProps { value: string; onChange: (value: string) => void; placeholder?: string; width?: number | string; }
export function SearchInput({ value, onChange, placeholder = "Buscar...", width = 260 }: SearchInputProps) {
  return <div className="ui-search" style={{ "--search-width": width === 9999 ? "100%" : typeof width === "number" ? width + "px" : width } as React.CSSProperties}>
    <Search size={16} className="ui-search__icon" aria-hidden="true" />
    <input type="search" aria-label={placeholder.replace(/\.{3}$/, "")} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
    {value && <button type="button" className="ui-icon-button ui-search__clear" onClick={() => onChange("")} aria-label="Limpar busca"><X size={14} aria-hidden="true" /></button>}
  </div>;
}
