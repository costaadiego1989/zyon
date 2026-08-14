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
        background: "#fff",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
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
          color: "var(--color-fg)",
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
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                background: isSelected ? "rgba(91, 61, 245, 0.04)" : "#fff",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
            >
              <input
                type="radio"
                name="shipping"
                checked={isSelected}
                onChange={() => setSelected(key)}
                style={{ accentColor: "var(--color-primary)" }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--color-fg)",
                  }}
                >
                  {option.carrier} — {option.name}
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--color-fg-soft)" }}
                >
                  {option.days} {option.days === 1 ? "dia útil" : "dias úteis"}
                </div>
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-primary)",
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
