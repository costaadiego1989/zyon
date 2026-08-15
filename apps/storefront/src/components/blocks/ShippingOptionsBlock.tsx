"use client";

import type { ShippingOptionsBlock as ShippingOptionsBlockType } from "@/lib/types";

export default function ShippingOptionsBlock({
  block,
}: {
  block: ShippingOptionsBlockType;
}) {
  const { options } = block.data;

  return (
    <div style={{ background: "var(--aacp-surface-2, rgba(255,255,255,0.04))", borderRadius: "14px", border: "1px solid var(--aacp-line)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <h4 style={{ fontSize: "13px", fontWeight: 700, margin: 0, color: "var(--aacp-fg)", fontFamily: "var(--aacp-font-display, var(--aacp-font))" }}>
        Opções de frete
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {options.map((option) => (
          <div
            key={`${option.carrier}-${option.name}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "10px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface, rgba(255,255,255,0.02))",
            }}
          >
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h13l5 5v7h-2" /><path d="M3 17V7" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--aacp-fg)" }}>
                {option.name}
              </div>
              <div style={{ fontSize: "11px", color: "var(--aacp-muted)" }}>
                {option.days} {option.days === 1 ? "dia útil" : "dias úteis"}
              </div>
            </div>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--aacp-accent)" }}>
              {option.priceFormatted}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
