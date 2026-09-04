import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";

export interface CouponComboboxProps {
  /** Selected coupon code (stored value). */
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

interface CouponOption {
  code: string;
  discountType: string;
  discountValue: number;
}

/** Normalize for accent-insensitive, case-insensitive matching. */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function couponBadge(c: CouponOption): string {
  if (c.discountType === "free_shipping" || c.discountType === "shipping_free") return "Frete grátis";
  if (c.discountType === "percent") return `${c.discountValue}%`;
  return `R$${(c.discountValue / 100).toFixed(0)}`;
}

/**
 * Searchable coupon combobox. Same visual + interaction pattern as
 * CategoryCombobox. Loads active coupons on first open, filters by code,
 * stores the coupon CODE as the value (the storefront resolves the coupon by
 * code via ApplyCoupon at cart time).
 */
export function CouponCombobox({ value, onChange, disabled }: CouponComboboxProps) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function loadCoupons() {
    if (loaded) return;
    setLoading(true);
    try {
      const data = await api.listCoupons();
      // Filter out only clearly-inactive coupons. The listCoupons mapper derives
      // `isActive` from status === "active" (lowercase) which misses the API's
      // "ACTIVE"/status variants, so a coupon can arrive isActive:false while
      // being usable — check status text case-insensitively and default to
      // showing the coupon rather than hiding it.
      const isArchived = (c: any) => {
        const s = String(c.status ?? "").toLowerCase();
        return s === "archived" || s === "expired" || s === "disabled" || c.isActive === false && s === "inactive";
      };
      setCoupons(
        (data ?? [])
          .filter((c: any) => !!c.code && !isArchived(c))
          .map((c: any) => ({
            code: c.code,
            discountType: c.discountType ?? c.discount_type ?? "percent",
            discountValue: c.discountValue ?? c.discount_value ?? 0,
          })),
      );
      setLoaded(true);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return coupons;
    return coupons.filter((c) => normalize(c.code).includes(q));
  }, [coupons, query]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function selectCoupon(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          if (!open) {
            setQuery("");
            void loadCoupons();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          background: "var(--surface-1)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ font: "13px var(--font-sans)", color: value ? "var(--color-text)" : "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || "Selecionar cupom..."}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
          {value ? (
            <button
              type="button"
              aria-label="Limpar cupom"
              onClick={(e) => {
                e.stopPropagation();
                selectCoupon("");
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
            placeholder="Buscar cupom..."
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--color-border)", font: "12.5px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)", marginBottom: 4 }}
          />
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: 10, textAlign: "center", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Carregando...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 10, textAlign: "center", font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Nenhum cupom ativo</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => selectCoupon(c.code)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "none", background: value === c.code ? "var(--color-brand-subtle)" : "transparent", color: "var(--color-text)", font: "12px var(--font-sans)", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}
                  onMouseEnter={(e) => { if (value !== c.code) e.currentTarget.style.background = "var(--surface-1)"; }}
                  onMouseLeave={(e) => { if (value !== c.code) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{c.code}</span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}>{couponBadge(c)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
