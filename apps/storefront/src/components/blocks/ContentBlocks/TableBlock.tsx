import type { TableBlockData } from "./types";

export default function TableBlock({ block }: { block: TableBlockData }) {
  return (
    <figure
      style={{
        margin: "14px 0",
        overflowX: "auto",
        fontFamily: "var(--aacp-font)",
      }}
    >
      {block.caption && (
        <figcaption
          style={{
            fontSize: "12.5px",
            color: "var(--aacp-muted)",
            marginBottom: "6px",
            textAlign: "left",
          }}
        >
          {block.caption}
        </figcaption>
      )}
      <table
        role="table"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "14px",
          color: "var(--aacp-fg)",
          background: "var(--aacp-surface)",
          border: "1px solid var(--aacp-line)",
          borderRadius: "var(--aacp-radius-sm)",
          overflow: "hidden",
        }}
      >
        {block.headers.length > 0 && (
          <thead>
            <tr>
              {block.headers.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    fontWeight: 600,
                    fontSize: "13px",
                    background: "var(--aacp-surface-2)",
                    borderBottom: "1px solid var(--aacp-line)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  style={{
                    padding: "10px 12px",
                    borderTop: rIdx === 0 ? "none" : "1px solid var(--aacp-line)",
                    color: "var(--aacp-fg)",
                    fontSize: "14px",
                    lineHeight: 1.5,
                    verticalAlign: "top",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
