import React from "react";
import { AlertTriangle } from "lucide-react";
import type { FunnelBottleneck, FunnelStep } from "../useFunnelPage.js";

interface BottleneckBannerProps {
  bottleneck: FunnelBottleneck;
  steps: FunnelStep[];
}

export function BottleneckBanner({ bottleneck, steps }: BottleneckBannerProps): React.ReactElement {
  const stepLabel = steps.find((s) => s.name === bottleneck.step)?.label ?? bottleneck.step;

  return (
    <div className="fnl-bottleneck" role="alert">
      <AlertTriangle size={18} strokeWidth={2} className="fnl-bottleneck-icon" />
      <div>
        <p className="fnl-bottleneck-title">
          Gargalo: {stepLabel} ({bottleneck.dropOff.toFixed(0)}% abandono)
        </p>
        <p className="fnl-bottleneck-text">{bottleneck.suggestion}</p>
      </div>
    </div>
  );
}
