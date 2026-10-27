import React from "react";
import { AlertCircle } from "lucide-react";
import type { ValidationError } from "../utils/csv-validation.js";

export interface CsvErrorListProps {
  errors: ValidationError[];
  maxToShow?: number;
}

export function CsvErrorList({ errors, maxToShow = 5 }: CsvErrorListProps) {
  if (errors.length === 0) return null;

  return (
    <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <AlertCircle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ font: "600 12px var(--sans)", color: "var(--danger)", marginBottom: 6 }}>
            Erros encontrados:
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, font: "12px var(--sans)", color: "var(--danger)" }}>
            {errors.slice(0, maxToShow).map((err, idx) => (
              <li key={idx}>
                Linha {err.rowIndex + 1}, coluna <strong>{err.field}</strong>: {err.message}
              </li>
            ))}
            {errors.length > maxToShow && <li>... e {errors.length - maxToShow} erros adicionais</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
