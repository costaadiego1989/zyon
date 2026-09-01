"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";

type OptionGroup = NonNullable<ProductCardBlockType["data"]["optionGroups"]>[number];

const formatCents = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/**
 * Food option-group selector (iFood/99food style). Single-selection groups render
 * as radios, multiple as checkboxes. Required groups are flagged. Selection is
 * lifted to the parent, which enforces required groups before enabling add and
 * embeds the chosen item ids in the add-to-cart payload. Price shown per item is
 * for buyer feedback only — the server re-computes the authoritative total.
 */
export function ProductCardOptions({
  groups,
  selectedItemIds,
  onToggle,
}: {
  groups: OptionGroup[];
  selectedItemIds: Set<string>;
  onToggle: (group: OptionGroup, itemId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingTop: "4px" }}>
      {groups.map((group) => {
        const satisfied = !group.required || group.items.some((it) => selectedItemIds.has(it.id));
        return (
          <div key={group.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontFamily: "var(--aacp-font-display)",
                }}
              >
                {group.name}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 7px",
                  borderRadius: "999px",
                  color: group.required ? "#fff" : "var(--aacp-muted)",
                  background: group.required
                    ? satisfied
                      ? "var(--aacp-success)"
                      : "#ef4444"
                    : "var(--aacp-surface-2)",
                  border: group.required ? "none" : "1px solid var(--aacp-line)",
                }}
              >
                {group.required ? (satisfied ? "OK" : "Obrigatório") : "Opcional"}
              </span>
              <span style={{ fontSize: "10.5px", color: "var(--aacp-muted)", marginLeft: "auto" }}>
                {group.selectionType === "single" ? "Escolha 1" : "Escolha quantos quiser"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {group.items.map((item) => {
                const isSelected = selectedItemIds.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role={group.selectionType === "single" ? "radio" : "checkbox"}
                    aria-checked={isSelected}
                    onClick={() => onToggle(group, item.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "9px 12px",
                      borderRadius: "9px",
                      border: isSelected
                        ? "1.5px solid var(--aacp-accent)"
                        : "1px solid var(--aacp-line)",
                      background: isSelected
                        ? "color-mix(in srgb, var(--aacp-accent) 10%, var(--aacp-surface-2))"
                        : "var(--aacp-surface-2)",
                      color: "var(--aacp-fg)",
                      fontSize: "13px",
                      fontWeight: 500,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: "18px",
                        height: "18px",
                        flexShrink: 0,
                        borderRadius: group.selectionType === "single" ? "50%" : "5px",
                        border: isSelected ? "5px solid var(--aacp-accent)" : "2px solid var(--aacp-line)",
                        background: isSelected && group.selectionType === "multiple" ? "var(--aacp-accent)" : "transparent",
                        boxSizing: "border-box",
                        transition: "all 0.15s ease",
                      }}
                    />
                    <span style={{ flex: 1 }}>{item.name}</span>
                    {item.priceModifierInCents > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--aacp-accent)" }}>
                        + {formatCents(item.priceModifierInCents)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
