import React from "react";
import type { CsvRow, ValidationError } from "../utils/csv-validation.js";
import { groupErrorsByRow } from "../utils/csv-validation.js";

export interface CsvPreviewTableProps {
  rows: CsvRow[];
  errors: ValidationError[];
}

export function CsvPreviewTable({ rows, errors }: CsvPreviewTableProps) {
  const errorsByRow = groupErrorsByRow(errors);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--font-mono)" }}>
        <thead>
          <tr style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--color-border)" }}>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>Nome</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>SKU</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>Preço</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>Estoque</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>Peso</th>
            <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600 }}>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              style={{
                borderBottom: "1px solid var(--color-border)",
                background: errorsByRow.has(idx) ? "var(--color-error-bg)" : "transparent",
              }}
            >
              <td style={{ padding: "8px 12px", color: "var(--color-text)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.name}
              </td>
              <td style={{ padding: "8px 12px", color: "var(--color-text-muted)", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.sku}
              </td>
              <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{row.price.toFixed(2)}</td>
              <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{row.stock ?? "-"}</td>
              <td style={{ padding: "8px 12px", color: "var(--color-text-muted)" }}>{row.weight_grams ? `${row.weight_grams}g` : "-"}</td>
              <td style={{ padding: "8px 12px", color: "var(--color-text-muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.description ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
