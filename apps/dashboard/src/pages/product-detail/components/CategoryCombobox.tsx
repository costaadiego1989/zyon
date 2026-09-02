import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export interface CategoryComboboxProps {
  categoryId: string;
  onCategoryIdChange: (v: string) => void;
  categories: Array<{ id: string; name: string }>;
}

/** Normalize for accent-insensitive, case-insensitive matching. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Searchable category combobox. Stored value is the category ID (via
 * onCategoryIdChange); the displayed value is the category NAME. Never exposes
 * a raw id input. Visual pattern mirrors CouponDropdown (RuleEditor.tsx).
 */
export function CategoryCombobox({ categoryId, onCategoryIdChange, categories }: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => categories.find((c) => c.id === categoryId) ?? null, [categories, categoryId]);
  const hasCategories = categories.length > 0;

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return categories;
    return categories.filter((c) => normalize(c.name).includes(q));
  }, [categories, query]);

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function selectCategory(id: string) {
    onCategoryIdChange(id);
    setOpen(false);
    setQuery("");
  }

  if (!hasCategories) {
    return (
      <input
        value=""
        disabled
        placeholder="Nenhuma categoria cadastrada"
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", font: "13px var(--font-sans)", color: "var(--color-text-faint)", outline: "none", background: "var(--surface-1)", cursor: "not-allowed", opacity: 0.7 }}
      />
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setQuery("");
        }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", cursor: "pointer" }}
      >
        <span style={{ font: "13px var(--font-sans)", color: selected ? "var(--color-text)" : "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.name : "Sem categoria"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
          {selected ? (
            <button
              type="button"
              aria-label="Limpar categoria"
              onClick={(e) => {
                e.stopPropagation();
                selectCategory("");
              }}
              style={{ display: "inline-flex", alignItems: "center", padding: 0, border: "none", background: "transparent", cursor: "pointer", color: "var(--color-text-faint)" }}
            >
              <X size={13} />
            </button>
          ) : null}
          <ChevronDown size={14} color="var(--color-text-faint)" />
        </span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 4, zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            placeholder="Buscar categoria..."
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--color-border)", font: "12.5px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)", marginBottom: 4 }}
          />
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            <button
              type="button"
              onClick={() => selectCategory("")}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: !categoryId ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text-muted)", font: "12px var(--font-sans)", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => { if (categoryId) e.currentTarget.style.background = "var(--surface-1)"; }}
              onMouseLeave={(e) => { if (categoryId) e.currentTarget.style.background = "transparent"; }}
            >
              Sem categoria
            </button>
            {filtered.length === 0 ? (
              <div style={{ padding: 10, textAlign: "center", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Nenhuma categoria encontrada</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCategory(c.id)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: categoryId === c.id ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text)", font: "12px var(--font-sans)", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { if (categoryId !== c.id) e.currentTarget.style.background = "var(--surface-1)"; }}
                  onMouseLeave={(e) => { if (categoryId !== c.id) e.currentTarget.style.background = "transparent"; }}
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
