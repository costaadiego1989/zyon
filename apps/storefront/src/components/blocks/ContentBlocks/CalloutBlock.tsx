import type { CalloutBlockData } from "./types";

const TONE_STYLES: Record<
  CalloutBlockData["tone"],
  { background: string; border: string; color: string; icon: string }
> = {
  info: {
    background: "color-mix(in srgb, #3b82f6 14%, var(--aacp-surface))",
    border: "color-mix(in srgb, #3b82f6 36%, var(--aacp-line))",
    color: "#93c5fd",
    icon: "i",
  },
  success: {
    background: "color-mix(in srgb, var(--aacp-success) 14%, var(--aacp-surface))",
    border: "color-mix(in srgb, var(--aacp-success) 40%, var(--aacp-line))",
    color: "var(--aacp-success)",
    icon: "OK",
  },
  warn: {
    background: "color-mix(in srgb, var(--aacp-warning) 18%, var(--aacp-surface))",
    border: "color-mix(in srgb, var(--aacp-warning) 42%, var(--aacp-line))",
    color: "var(--aacp-warning)",
    icon: "!",
  },
  danger: {
    background: "color-mix(in srgb, #ef4444 14%, var(--aacp-surface))",
    border: "color-mix(in srgb, #ef4444 36%, var(--aacp-line))",
    color: "#fca5a5",
    icon: "x",
  },
};

export default function CalloutBlock({ block }: { block: CalloutBlockData }) {
  const tone = TONE_STYLES[block.tone];
  return (
    <aside
      role="note"
      aria-label={block.title ?? "Aviso"}
      style={{
        margin: "14px 0",
        padding: "12px 14px",
        borderRadius: "var(--aacp-radius-sm)",
        background: tone.background,
        border: `1px solid ${tone.border}`,
        display: "flex",
        gap: "10px",
        alignItems: "flex-start",
        fontFamily: "var(--aacp-font)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: "22px",
          height: "22px",
          flexShrink: 0,
          borderRadius: "50%",
          background: tone.color,
          color: "#0b0b10",
          fontWeight: 800,
          fontSize: "12px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textTransform: "uppercase",
        }}
      >
        {tone.icon}
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          minWidth: 0,
          flex: 1,
        }}
      >
        {block.title && (
          <strong
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--aacp-fg)",
              lineHeight: 1.3,
            }}
          >
            {block.title}
          </strong>
        )}
        <span
          style={{
            fontSize: "14px",
            lineHeight: 1.55,
            color: "var(--aacp-fg)",
            wordBreak: "break-word",
          }}
        >
          {block.text}
        </span>
      </div>
    </aside>
  );
}
