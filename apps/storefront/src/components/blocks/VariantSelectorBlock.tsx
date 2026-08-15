"use client";

import { useState } from "react";
import type { VariantSelectorBlock as VariantSelectorBlockType } from "@/lib/types";

const COLOR_MAP: Record<string, string> = {
  preto: "#1a1a1a",
  azul: "#2563eb",
  verde: "#16a34a",
  branco: "#f5f5f5",
  vermelho: "#dc2626",
  cinza: "#6b7280",
  bege: "#d4a574",
  marinho: "#1e3a5f",
  amarelo: "#eab308",
  rosa: "#ec4899",
};

function lookupColor(value: string): string | null {
  const norm = value.toLowerCase().trim();
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (norm === key || norm.includes(key)) return hex;
  }
  return null;
}

export default function VariantSelectorBlock({
  block,
  onQuickReply,
}: {
  block: VariantSelectorBlockType;
  onQuickReply?: (text: string) => void;
}) {
  const { productName, groups } = block.data;
  const [selected, setSelected] = useState<Record<string, string>>({});

  function handleSelect(groupName: string, value: string) {
    setSelected((prev) => ({ ...prev, [groupName]: value }));
    if (onQuickReply) {
      onQuickReply(`Selecionar ${value} do ${productName}`);
    }
  }

  return (
    <div
      style={{
        borderRadius: "var(--aacp-radius-md)",
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: "var(--aacp-shadow-sm)",
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--aacp-fg)",
          lineHeight: 1.3,
        }}
      >
        Escolha uma opcao
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--aacp-muted)",
          marginTop: -10,
        }}
      >
        {productName}
      </div>

      {groups.map((group) => (
        <div key={group.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--aacp-muted)",
              textTransform: "uppercase",
              letterSpacing: 1.2,
              fontFamily: "var(--aacp-font-mono)",
            }}
          >
            {group.name}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {group.options.map((opt) => {
              const colorHex = lookupColor(opt.value);
              const isSelected = selected[group.name] === opt.value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => opt.available && handleSelect(group.name, opt.value)}
                  disabled={!opt.available}
                  title={opt.available ? opt.value : `${opt.value} (indisponivel)`}
                  style={{
                    appearance: "none",
                    cursor: opt.available ? "pointer" : "not-allowed",
                    opacity: opt.available ? 1 : 0.4,
                    transition:
                      "transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
                    transform: isSelected ? "scale(1.06)" : "scale(1)",
                    border: isSelected
                      ? "2px solid var(--aacp-accent)"
                      : "1px solid var(--aacp-line)",
                    background: "var(--aacp-surface-2)",
                    color: "var(--aacp-fg)",
                    padding: colorHex ? 0 : "7px 14px",
                    borderRadius: "var(--aacp-radius-pill)",
                    fontSize: 12.5,
                    fontWeight: 500,
                    fontFamily: "var(--aacp-font)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: colorHex ? 26 : undefined,
                    height: colorHex ? 26 : undefined,
                    boxShadow: isSelected ? "var(--aacp-glow)" : "none",
                    position: "relative",
                  }}
                >
                  {colorHex ? (
                    <>
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: colorHex,
                          display: "block",
                          boxShadow: colorHex === "#f5f5f5" ? "inset 0 0 0 1px rgba(0,0,0,0.08)" : "none",
                          position: "absolute",
                          inset: 0,
                          margin: "auto",
                          pointerEvents: "none",
                        }}
                      />
                    </>
                  ) : (
                    opt.value
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
