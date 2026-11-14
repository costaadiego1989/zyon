import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Plus, X } from "lucide-react";

export interface CategoryComboboxProps {
  categoryId: string;
  onCategoryIdChange: (v: string) => void;
  categories: Array<{ id: string; name: string }>;
  onCreateCategory?: (name: string) => Promise<{ id: string; name: string }>;
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
export function CategoryCombobox({ categoryId, onCategoryIdChange, categories, onCreateCategory }: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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
    setCreateError(null);
  }

  async function createCategory() {
    const name = query.trim();
    if (!name || !onCreateCategory || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreateCategory(name);
      selectCategory(created.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Não foi possível criar a categoria.");
    } finally {
      setCreating(false);
    }
  }

  const requestedName = query.trim();
  const exactMatch = requestedName
    ? categories.some((category) => normalize(category.name) === normalize(requestedName))
    : false;
  const canCreate = Boolean(onCreateCategory && requestedName && !exactMatch);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={0}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) {
            setQuery("");
            setCreateError(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", cursor: "pointer" }}
      >
        <span style={{ font: "13px var(--font-sans)", color: selected ? "var(--color-text)" : "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.name : hasCategories ? "Sem categoria" : "Criar ou escolher uma categoria"}
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
          <div role="listbox" style={{ maxHeight: 180, overflowY: "auto" }}>
            <button
              type="button"
              onClick={() => selectCategory("")}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: !categoryId ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text-muted)", font: "12px var(--font-sans)", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => { if (categoryId) e.currentTarget.style.background = "var(--surface-1)"; }}
              onMouseLeave={(e) => { if (categoryId) e.currentTarget.style.background = "transparent"; }}
            >
              Sem categoria
            </button>
            {canCreate ? (
              <button
                type="button"
                disabled={creating}
                onClick={() => void createCategory()}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, border: "none", background: "var(--color-brand-subtle)", color: "var(--color-brand-hover)", font: "600 12px var(--font-sans)", cursor: creating ? "wait" : "pointer", textAlign: "left" }}
              >
                {creating ? <LoaderCircle size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                {creating ? "Criando categoria..." : `Criar “${requestedName}”`}
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <div style={{ padding: canCreate ? "7px 10px" : 10, textAlign: "center", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>{hasCategories ? "Nenhuma categoria encontrada" : "Digite o nome para criar a primeira categoria"}</div>
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
            {createError ? <div role="alert" style={{ padding: "7px 10px", color: "var(--color-error)", font: "11px var(--font-sans)" }}>{createError}</div> : null}
          </div>
        </div>
      )}
    </div>
  );
}
