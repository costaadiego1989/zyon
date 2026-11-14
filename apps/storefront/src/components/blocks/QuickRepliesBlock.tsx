"use client";

import type { QuickRepliesBlock as QuickRepliesBlockType } from "@/lib/types";
import type { StorefrontReadUiAction } from "@zyon/shared-types";
import { parseSuggestedReadActions } from "@/lib/storefront-suggested-read-actions";

export default function QuickRepliesBlock({
  block,
  onSelect,
}: {
  block: QuickRepliesBlockType;
  onSelect?: (option: string, uiAction?: StorefrontReadUiAction) => void;
}) {
  const suggested = parseSuggestedReadActions(block.data.suggestedActions);
  const replies: Array<{ id: string; label: string; action?: StorefrontReadUiAction }> = [
    ...block.data.options.map((label, index) => ({ id: `legacy-${index}`, label })),
    ...(suggested?.items ?? []),
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
      }}
    >
      {replies.map(({ id, label, action }) => (
        <button data-neu="control"
          key={action === undefined ? id : `suggested-${id}`}
          type="button"
          onClick={() => {
            if (action === undefined) {
              onSelect?.(label);
              return;
            }
            const selected = parseSuggestedReadActions({ version: 1, items: [{ id, label, action }] })?.items[0];
            if (selected) onSelect?.(selected.label, selected.action);
          }}
          style={{
            padding: "9px 16px",
            borderRadius: "var(--aacp-radius-pill)",
            border: "1px solid var(--aacp-line-strong)",
            background: "var(--aacp-surface)",
            color: "var(--aacp-muted)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "border-color 0.18s ease, background 0.18s ease, color 0.18s ease",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--aacp-accent-hover-border)";
            el.style.background = "var(--aacp-accent-hover-bg)";
            el.style.color = "var(--aacp-fg)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--aacp-line-strong)";
            el.style.background = "var(--aacp-surface)";
            el.style.color = "var(--aacp-muted)";
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
