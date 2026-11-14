import type { ListBlockData } from "./types";

export default function ListBlock({ block }: { block: ListBlockData }) {
  const isOrdered = block.style === "ordered";
  const Tag = isOrdered ? "ol" : "ul";
  const containerStyle: React.CSSProperties = {
    margin: "0 0 14px 0",
    paddingLeft: "22px",
    fontFamily: "var(--aacp-font)",
    fontSize: "15px",
    lineHeight: 1.6,
    color: "var(--aacp-fg)",
  };
  return (
    <Tag style={containerStyle}>
      {block.items.map((item, idx) => (
        <li key={idx} style={{ marginBottom: "4px" }}>
          {item}
        </li>
      ))}
    </Tag>
  );
}
