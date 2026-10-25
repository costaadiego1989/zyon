import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";

/**
 * Search dropdown for selecting another merchant product.
 *
 * Used by the Advanced Product Layout button block to redirect users to a
 * different product page on the storefront instead of an external URL.
 *
 * Loads a single page of merchant products on demand (debounced search). The
 * selected value is a product id; the display label is the product name.
 */
export interface ProductSearchDropdownProps {
  merchantId: string;
  /** Excluded product id (so a button can't redirect to itself). */
  excludeProductId?: string;
  value: string;
  onChange: (productId: string) => void;
  disabled?: boolean;
}

interface ProductRow {
  id: string;
  name: string;
}

export function ProductSearchDropdown({
  merchantId,
  excludeProductId,
  value,
  onChange,
  disabled = false,
}: ProductSearchDropdownProps) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Initial load + debounced search
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        setLoading(true);
        const result = await api.listProducts(merchantId, { query: search, limit: 30 });
        if (cancelled) return;
        const items: ProductRow[] = (result.products ?? []).map((p) => ({
          id: p.id,
          name: p.name ?? "(sem nome)",
        }));
        setProducts(items);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, search, api, merchantId]);

  const filtered = useMemo(() => {
    return excludeProductId
      ? products.filter((p) => p.id !== excludeProductId)
      : products;
  }, [products, excludeProductId]);

  const selected = filtered.find((p) => p.id === value) ?? products.find((p) => p.id === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          font: "13px var(--font-sans)",
          color: selected ? "var(--color-text)" : "var(--color-text-faint)",
          background: "var(--surface-2)",
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span>{selected ? selected.name : "Buscar produto..."}</span>
        <span style={{ fontSize: 10, color: "var(--color-text-faint)" }}>▾</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            zIndex: 200,
            maxHeight: 260,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <Search size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              autoFocus
              style={{
                flex: 1,
                border: "none",
                font: "13px var(--font-sans)",
                color: "var(--color-text)",
                background: "transparent",
                outline: "none",
              }}
            />
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {selected ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-border)",
                  font: "12px var(--font-sans)",
                  color: "var(--color-danger, #b91c1c)",
                  cursor: "pointer",
                }}
              >
                Limpar seleção
              </button>
            ) : null}

            {loading ? (
              <div style={{ padding: "14px 12px", color: "var(--color-text-faint)", font: "12px var(--font-sans)" }}>
                Buscando...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: "14px 12px", color: "var(--color-text-faint)", font: "12px var(--font-sans)" }}>
                Nenhum produto encontrado.
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    background: p.id === value ? "var(--color-brand-subtle, color-mix(in oklch, var(--color-brand, #0f766e) 12%, transparent))" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    font: "13px var(--font-sans)",
                    color: "var(--color-text)",
                    cursor: "pointer",
                  }}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
