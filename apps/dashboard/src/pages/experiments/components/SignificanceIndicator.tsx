import React from "react";

interface SignificanceIndicatorProps {
  confidence: number;
}

export function SignificanceIndicator({ confidence }: SignificanceIndicatorProps) {
  if (confidence >= 95) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ font: "28px", marginBottom: 4 }}>✓</div>
        <span style={{ font: "11px var(--font-sans)", color: "var(--color-success)" }}>Significante</span>
      </div>
    );
  }
  if (confidence >= 80) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ font: "28px", marginBottom: 4 }}>◐</div>
        <span style={{ font: "11px var(--font-sans)", color: "var(--color-brand)" }}>Pendente</span>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ font: "28px", marginBottom: 4 }}>○</div>
      <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>Inicial</span>
    </div>
  );
}
