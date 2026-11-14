import { EmptyState } from "../../../components/EmptyState.js";
import React from "react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import type { FunnelSegment } from "../useFunnelPage.js";

interface FunnelBreakdownProps {
  breakdowns: Record<string, FunnelSegment>;
  dimension: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  device: "dispositivo",
  buyer_type: "tipo de comprador",
  payment_method: "pagamento",
};

const SEGMENT_LABELS: Record<string, string> = {
  unknown: "Não informado",
  mobile: "Celular",
  desktop: "Computador",
  tablet: "Tablet",
  new: "Novo",
  returning: "Recorrente",
  pix: "PIX",
  card: "Cartão",
  credit_card: "Cartão",
  boleto: "Boleto",
  crypto: "Criptomoeda (USDC)",
};

export function FunnelBreakdown({ breakdowns, dimension }: FunnelBreakdownProps): React.ReactElement {
  const entries = Object.entries(breakdowns);

  return (
    <div className="fnl-breakdown-card">
      <SectionHeader
        variant="secondary"
        title={`Por ${DIMENSION_LABELS[dimension] ?? dimension}`}
      />
      {!entries.length ? <EmptyState title="Sem dados para esta segmentação" description="Tente outra segmentação ou um período com mais sessões." /> : <div className="fnl-breakdown-items">
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
                style={{ width: `${Math.max(0, Math.min(segment.overallConversion, 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}
