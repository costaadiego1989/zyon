import React from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import type { FunnelBottleneck, FunnelInsight, FunnelStep } from "../useFunnelPage.js";

interface BottleneckBannerProps {
  bottleneck: FunnelBottleneck;
  steps: FunnelStep[];
}

const MODULE_LABELS: Record<FunnelInsight["module"], string> = {
  "intent-memory": "Intent Memory",
  "cart-recovery": "Cart Recovery",
  "revenue-manager": "Revenue Manager",
  "rules-engine": "Rules Engine",
  "shipping-engine": "Shipping Engine",
  "general": "Análise geral",
};

export function BottleneckBanner({ bottleneck, steps }: BottleneckBannerProps): React.ReactElement {
  const stepLabel = steps.find((s) => s.name === bottleneck.step)?.label ?? bottleneck.step;
  const insight = bottleneck.insight;

  return (
    <div className="fnl-bottleneck" role="alert">
      <AlertTriangle size={18} strokeWidth={2} className="fnl-bottleneck-icon" />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p className="fnl-bottleneck-title">
          Gargalo: {stepLabel} ({bottleneck.dropOff.toFixed(0)}% abandono)
        </p>
        {insight ? (
          <>
            <p
              className="fnl-bottleneck-text"
              style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)", fontWeight: 600 }}
            >
              <Sparkles size={12} strokeWidth={2} /> {insight.headline}
            </p>
            <p className="fnl-bottleneck-text">{insight.detail}</p>
            <p className="fnl-bottleneck-text">
              <strong>Ação sugerida: </strong>
              {insight.action}
            </p>
            <p
              className="fnl-bottleneck-text"
              style={{ fontSize: 10, color: "var(--faint)", letterSpacing: "0.04em", textTransform: "uppercase" }}
            >
              Origem: {MODULE_LABELS[insight.module]}
            </p>
          </>
        ) : (
          <p className="fnl-bottleneck-text">{bottleneck.suggestion}</p>
        )}
      </div>
    </div>
  );
}
