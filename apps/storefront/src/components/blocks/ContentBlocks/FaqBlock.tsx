"use client";

import type { FaqBlockData } from "./types";

/**
 * FAQ accordion using native <details>/<summary>. Server-renderable, mobile-first,
 * no JS required to expand — preserves accessibility even if hydration fails.
 */
export default function FaqBlock({ block }: { block: FaqBlockData }) {
  return (
    <div
      role="list"
      style={{
        margin: "14px 0",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        fontFamily: "var(--aacp-font)",
      }}
    >
      {block.items.map((item, idx) => (
        <details
          key={idx}
          role="listitem"
          style={{
            background: "var(--aacp-surface)",
            border: "1px solid var(--aacp-line)",
            borderRadius: "var(--aacp-radius-sm)",
            overflow: "hidden",
          }}
        >
          <summary
            style={{
              listStyle: "none",
              cursor: "pointer",
              padding: "12px 14px",
              fontSize: "14.5px",
              fontWeight: 600,
              color: "var(--aacp-fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
            }}
          >
            <span>{item.question}</span>
            <span
              aria-hidden
              style={{
                fontSize: "14px",
                color: "var(--aacp-muted)",
                transition: "transform 0.2s ease",
              }}
            >
              +
            </span>
          </summary>
          <div
            style={{
              padding: "0 14px 12px 14px",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "var(--aacp-muted)",
              borderTop: "1px solid var(--aacp-line)",
              paddingTop: "10px",
            }}
          >
            {item.answer}
          </div>
        </details>
      ))}
    </div>
  );
}
