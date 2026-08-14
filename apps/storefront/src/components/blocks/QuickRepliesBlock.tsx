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
        gap: 8,
      }}
    >
      {block.data.options.map((option, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onSelect?.(option)}
          style={{
            padding: "8px 12px",
            borderRadius: "14px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface-2)",
            color: "var(--aacp-fg)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 160ms ease",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--aacp-accent)";
            (e.currentTarget as HTMLButtonElement).style.background =
              "color-mix(in srgb, var(--aacp-accent) 8%, var(--aacp-surface-2))";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--aacp-line)";
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--aacp-surface-2)";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateY(0)";
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
