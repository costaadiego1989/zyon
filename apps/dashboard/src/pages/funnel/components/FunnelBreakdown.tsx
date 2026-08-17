import React from "react";
import type { FunnelSegment } from "../useFunnelPage.js";

interface FunnelBreakdownProps {
  breakdowns: Record<string, FunnelSegment>;
  dimension: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  device: "Dispositivo",
  buyer_type: "Tipo de comprador",
  payment_method: "Pagamento",
};

const SEGMENT_LABELS: Record<string, string> = {
  mobile: "Mobile",
  desktop: "Desktop",
  tablet: "Tablet",
  new: "Novo",
  returning: "Recorrente",
  pix: "Pix",
  card: "Cartão",
  boleto: "Boleto",
  other: "Outro",
};

const SEGMENT_COLORS: Record<string, string> = {
  mobile: "#3b82f6",
  desktop: "#10b981",
  tablet: "#f59e0b",
  new: "#6366f1",
  returning: "#ec4899",
  pix: "#14b8a6",
  card: "#8b5cf6",
  boleto: "#f97316",
  other: "#6b7280",
};

export function FunnelBreakdown({ breakdowns, dimension }: FunnelBreakdownProps): React.ReactElement {
  const entries = Object.entries(breakdowns);

  if (entries.length === 0) {
    return (
      <div className="funnel-breakdown-empty">
        Sem dados de segmentação para este período.
      </div>
    );
  }

  return (
    <div className="funnel-breakdown">
      <h3 className="funnel-breakdown-title">
        Segmentação por {DIMENSION_LABELS[dimension] ?? dimension}
      </h3>
      <div className="funnel-breakdown-grid">
        {entries.map(([segmentKey, segment]) => (
          <div key={segmentKey} className="funnel-breakdown-segment">
            <div className="funnel-breakdown-segment-header">
              <span
                className="funnel-breakdown-dot"
                style={{ background: SEGMENT_COLORS[segmentKey] ?? "#6b7280" }}
              />
              <span className="funnel-breakdown-segment-name">
                {SEGMENT_LABELS[segmentKey] ?? segmentKey}
              </span>
              <span className="funnel-breakdown-segment-conv">
                {segment.overallConversion.toFixed(1)}%
              </span>
            </div>
            <div className="funnel-breakdown-bars">
              {segment.steps.map((step) => (
                <div key={step.name} className="funnel-breakdown-bar-row">
                  <span className="funnel-breakdown-bar-label">{step.label}</span>
                  <div className="funnel-breakdown-bar-track">
                    <div
                      className="funnel-breakdown-bar-fill"
                      style={{
                        width: `${step.percentage}%`,
                        background: SEGMENT_COLORS[segmentKey] ?? "#6b7280",
                      }}
                    />
                  </div>
                  <span className="funnel-breakdown-bar-value">
                    {step.count} ({step.percentage.toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
