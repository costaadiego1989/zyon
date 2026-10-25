import type { HeadingBlockData } from "./types";

export default function HeadingBlock({ block }: { block: HeadingBlockData }) {
  const style = {
    margin: "20px 0 10px 0",
    fontFamily: "var(--aacp-font-display)",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--aacp-fg)",
    lineHeight: 1.25,
    wordBreak: "break-word" as const,
  };

  if (block.level === 3) {
    return (
      <h3 style={{ ...style, fontSize: "18px" }}>
        {block.text}
      </h3>
    );
  }
  return (
    <h2 style={{ ...style, fontSize: "22px" }}>
      {block.text}
    </h2>
  );
}
