"use client";

import type { QuickRepliesBlock as QuickRepliesBlockType } from "@/lib/types";

export default function QuickRepliesBlock({
  block,
  onSelect,
}: {
  block: QuickRepliesBlockType;
  onSelect?: (option: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "16px",
      }}
    >
      {block.data.options.map((option, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onSelect?.(option)}
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
          {option}
        </button>
      ))}
    </div>
  );
}
