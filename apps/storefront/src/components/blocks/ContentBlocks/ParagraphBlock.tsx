import type { ParagraphBlockData } from "./types";

export default function ParagraphBlock({ block }: { block: ParagraphBlockData }) {
  return (
    <p
      style={{
        margin: "0 0 12px 0",
        fontFamily: "var(--aacp-font)",
        fontSize: "15px",
        lineHeight: 1.65,
        color: "var(--aacp-fg)",
        wordBreak: "break-word",
      }}
    >
      {block.text}
    </p>
  );
}
