"use client";

import { useState } from "react";

interface CouponItem {
  code: string;
  description: string;
  minCartValue?: number;
  minCartValueFormatted?: string;
  expiresAt: string | null;
}

interface CouponListBlockData {
  coupons: CouponItem[];
  progressive?: { maxPercent: number; description: string };
  advancedRules?: Array<{ label: string }>;
}

function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function CouponListBlock({
  block,
}: {
  block: { type: "coupon_list"; data: CouponListBlockData };
  onQuickReply?: (option: string) => void;
}) {
  const { coupons, progressive, advancedRules } = block.data;
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (code: string) => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1800);
    } catch { /* clipboard unavailable — ignore */ }
  };

  const hasContent = coupons.length > 0 || progressive || (advancedRules && advancedRules.length > 0);
  if (!hasContent) {
    return (
      <div style={{ width: "100%", padding: "12px 14px", borderRadius: "var(--aacp-radius)", border: "1px dashed var(--aacp-line-strong)", color: "var(--aacp-muted)", fontSize: 13 }}>
        Nenhum cupom ou promoção ativa no momento.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
      {coupons.map((c) => (
        <div
          key={c.code}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 14px",
            borderRadius: "var(--aacp-radius)",
            border: "1px solid var(--aacp-line-strong)",
            background: "var(--aacp-surface)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--aacp-fg)" }}>{c.description}</span>
            <span style={{ fontSize: 12, color: "var(--aacp-muted)" }}>
              {c.minCartValueFormatted ? `Em compras acima de ${c.minCartValueFormatted}` : "Sem valor mínimo"}
              {formatExpiry(c.expiresAt) ? ` · válido até ${formatExpiry(c.expiresAt)}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => copy(c.code)}
            style={{
              flex: "0 0 auto",
              padding: "8px 14px",
              borderRadius: "var(--aacp-radius-pill)",
              border: "1px dashed var(--aacp-accent-hover-border)",
              background: copied === c.code ? "var(--aacp-accent-hover-bg)" : "transparent",
              color: "var(--aacp-fg)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {copied === c.code ? "Copiado!" : c.code}
          </button>
        </div>
      ))}

      {progressive && (
        <div style={{ padding: "12px 14px", borderRadius: "var(--aacp-radius)", border: "1px solid var(--aacp-line-strong)", background: "var(--aacp-surface)" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--aacp-fg)" }}>{progressive.description}</span>
        </div>
      )}

      {advancedRules && advancedRules.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {advancedRules.map((r, i) => (
            <div key={i} style={{ padding: "10px 14px", borderRadius: "var(--aacp-radius)", border: "1px solid var(--aacp-line-strong)", background: "var(--aacp-surface)", fontSize: 13, color: "var(--aacp-fg)" }}>
              {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
