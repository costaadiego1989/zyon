import React from "react";
import type { FunnelSegment } from "../useFunnelPage.js";

interface FunnelBreakdownProps {
  breakdowns: Record<string, FunnelSegment>;
  dimension: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  device: "Dispositivo",
  buyer_type: "Tipo de Comprador",
  payment_method: "Pagamento",
};

const SEGMENT_LABELS: Record<string, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
  new: "Novo",
  returning: "Recorrente",
  pix: "PIX",
  card: "Cartão",
  boleto: "Boleto",
};

const DIMENSION_DEFAULTS: Record<string, string[]> = {
  device: ["mobile", "desktop", "tablet"],
  buyer_type: ["new", "returning"],
  payment_method: ["pix", "card", "boleto"],
};

export function FunnelBreakdown({ breakdowns, dimension }: FunnelBreakdownProps): React.ReactElement {
  let entries = Object.entries(breakdowns);

  // If no data, show zeroed structure so layout is visible
  if (entries.length === 0) {
    const defaults = DIMENSION_DEFAULTS[dimension] ?? ["unknown"];
    entries = defaults.map(key => [key, { steps: [], overallConversion: 0 }]);
  }

  return (
    <div className="fnl-breakdown-card">
      <h3 className="fnl-breakdown-title">
        Por {DIMENSION_LABELS[dimension] ?? dimension}
      </h3>
      <div className="fnl-breakdown-items">
        {entries.map(([key, segment]) => (
          <div key={key} className="fnl-breakdown-item">
            <div className="fnl-breakdown-item-head">
              <span className="fnl-breakdown-item-name">
                {SEGMENT_LABELS[key] ?? key}
              </span>
              <span className="fnl-breakdown-item-value">
                {segment.overallConversion.toFixed(1)}%
              </span>
            </div>
            <div className="fnl-breakdown-track">
              <div
                className="fnl-breakdown-fill"
                style={{ width: `${Math.max(segment.overallConversion, 3)}%` }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {segment.steps.map((step) => (
                <span key={step.name} style={{ font: "500 10px var(--font-data)", color: "var(--faint)" }}>
                  {step.label}: {step.count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
