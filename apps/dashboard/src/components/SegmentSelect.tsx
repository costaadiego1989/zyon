import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SelectOption } from "../lib/signup-options.js";
import "./SegmentSelect.css";

export interface SegmentSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  hasError?: boolean;
}

/**
 * SegmentSelect — search dropdown for the merchant store-category field.
 * Native <select> with 37 emoji-prefixed options renders an ugly native list
 * that varies per OS and looks out of place on the dark auth surface.
 * This gives a filterable, theme-styled dropdown that matches the rest of
 * the dashboard.
 */
export function SegmentSelect({
  value,
  onChange,
  options,
  placeholder = "Buscar segmento…",
  ariaLabel = "Segmento da loja",
  hasError = false,
}: SegmentSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  function commit(option: SelectOption) {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) commit(opt);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`segment-select ${open ? "is-open" : ""} ${hasError ? "has-error" : ""}`}>
      <button
        type="button"
        className="segment-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className="segment-select__value">
            {selected.emoji ? <span className="segment-select__emoji" aria-hidden>{selected.emoji}</span> : null}
            {selected.label}
          </span>
        ) : (
          <span className="segment-select__placeholder">{placeholder}</span>
        )}
      </button>
      {open ? (
        <div className="segment-select__popover" role="dialog">
          <div className="segment-select__search">
            <Search size={14} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              className="segment-select__input"
              placeholder="Buscar…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
            />
            {query ? (
              <button type="button" className="segment-select__clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Limpar busca">
                <X size={12} />
              </button>
            ) : null}
          </div>
          <ul id={listboxId} role="listbox" className="segment-select__list">
            {filtered.length === 0 ? (
              <li className="segment-select__empty">Nenhum segmento encontrado</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={`segment-select__option ${idx === highlight ? "is-highlight" : ""} ${opt.value === value ? "is-selected" : ""}`}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => commit(opt)}
                >
                  {opt.emoji ? <span className="segment-select__emoji" aria-hidden>{opt.emoji}</span> : null}
                  <span>{opt.label}</span>
                </li>
              ))
            )}
          </ul>
          <div className="segment-select__footer">{filtered.length} de {options.length}</div>
        </div>
      ) : null}
    </div>
  );
}
