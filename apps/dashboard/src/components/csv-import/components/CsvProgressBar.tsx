import React from "react";
import { Download } from "lucide-react";

export interface CsvProgressBarProps {
  isImporting: boolean;
  rowCount: number;
}

export function CsvProgressBar({ isImporting, rowCount }: CsvProgressBarProps) {
  if (!isImporting) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>Importando...</span>
        <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>{rowCount} registros</span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--surface-1)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "var(--color-brand-hover)",
            animation: "pulse 1.5s ease-in-out infinite",
            width: "30%",
          }}
        />
      </div>
    </div>
  );
}
