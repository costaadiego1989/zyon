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
            borderRadius: "999px",
            border: "1px solid var(--color-border)",
            background: "#fff",
            color: "var(--color-fg)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--color-primary)";
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(91, 61, 245, 0.04)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--color-border)";
            (e.currentTarget as HTMLButtonElement).style.background = "#fff";
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
