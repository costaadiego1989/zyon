import React from "react";
import type { FunnelBottleneck } from "../useFunnelPage.js";

interface BottleneckBannerProps {
  bottleneck: FunnelBottleneck;
  steps: Array<{ name: string; label: string }>;
}

export function BottleneckBanner({ bottleneck, steps }: BottleneckBannerProps): React.ReactElement {
  const stepLabel = steps.find((s) => s.name === bottleneck.step)?.label ?? bottleneck.step;

  return (
    <div className="funnel-bottleneck" role="alert">
      <svg
        className="funnel-bottleneck-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="funnel-bottleneck-content">
        <p className="funnel-bottleneck-title">
          Gargalo detectado: {stepLabel} ({(bottleneck.dropOff * 100).toFixed(0)}% de perda)
        </p>
        <p className="funnel-bottleneck-text">{bottleneck.suggestion}</p>
      </div>
    </div>
  );
}
