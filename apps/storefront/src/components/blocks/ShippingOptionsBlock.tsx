"use client";

import { useState } from "react";
import type { ShippingOptionsBlock as ShippingOptionsBlockType } from "@/lib/types";

export default function ShippingOptionsBlock({
  block,
}: {
  block: ShippingOptionsBlockType;
}) {
  const { options } = block.data;
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div
      style={{
        background: "var(--aacp-surface)",
        borderRadius: "var(--aacp-radius-md)",
        border: "1px solid var(--aacp-line)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h4
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: 0,
          color: "var(--aacp-fg)",
          fontFamily: "var(--aacp-font-display)",
        }}
      >
        Opções de entrega
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {options.map((option) => {
          const key = `${option.carrier}-${option.name}`;
          const isSelected = selected === key;
          return (
            <label
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: "var(--aacp-radius-sm)",
                border: `1px solid ${isSelected ? "var(--aacp-accent)" : "var(--aacp-line)"}`,
                background: isSelected ? "color-mix(in srgb, var(--aacp-accent) 8%, var(--aacp-surface))" : "var(--aacp-surface)",
                cursor: "pointer",
                transition: "border-color 160ms ease",
              }}
            >
              <input
                type="radio"
                name="shipping"
                checked={isSelected}
                onChange={() => setSelected(key)}
                style={{ accentColor: "var(--aacp-accent)" }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--aacp-fg)",
                  }}
                >
                  {option.carrier} — {option.name}
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--aacp-muted)" }}
                >
                  {option.days} {option.days === 1 ? "dia útil" : "dias úteis"}
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--aacp-accent)",
                }}
              >
                {option.priceFormatted}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
