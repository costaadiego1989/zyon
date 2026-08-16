import React, { useMemo } from "react";
import type { FunnelStep, FunnelTransition } from "../useFunnelPage.js";

interface FunnelChartProps {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
}

const COLOR_SCHEME = {
  light1: "#3b82f6", // brand blue
  light2: "#60a5fa",
  light3: "#93c5fd",
  light4: "#dbeafe",
  danger: "#ef4444",
};

export function FunnelChart({ steps, transitions }: FunnelChartProps): React.ReactElement {
  const chartData = useMemo(() => {
    const data: Array<{
      step: FunnelStep;
      barWidth: string;
      color: string;
      transition?: FunnelTransition;
    }> = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isPastHalf = step.percentage < 50;
      const isHigh = step.percentage >= 70;

      // Color: blend down from brand color, or red if high drop-off next
      let color = COLOR_SCHEME.light1;
      if (i === steps.length - 1) {
        color = COLOR_SCHEME.light4;
      } else {
        const nextTransition = transitions.find((t) => t.from === step.name);
        if (nextTransition && nextTransition.dropOff > 0.5) {
          color = COLOR_SCHEME.danger;
        } else {
          const lightness = [COLOR_SCHEME.light1, COLOR_SCHEME.light2, COLOR_SCHEME.light3, COLOR_SCHEME.light4];
          color = lightness[Math.min(i, 3)];
        }
      }

      data.push({
        step,
        barWidth: `${step.percentage}%`,
        color,
        transition: transitions.find((t) => t.from === step.name),
      });
    }

    return data;
  }, [steps, transitions]);

  // SVG dimensions
  const svgWidth = 800;
  const svgHeight = 400;
  const barHeight = 50;
  const gapY = 80;
  const labelX = 20;
  const arrowX = svgWidth - 100;

  return (
    <svg className="funnel-chart-svg" viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker
          id="arrowDown"
          markerWidth="10"
          markerHeight="10"
          refX="5"
          refY="5"
          orient="auto"
        >
          <path d="M 1 2 L 5 8 L 9 2" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" />
        </marker>
      </defs>

      {chartData.map((item, idx) => {
        const yOffset = idx * gapY + 40;

        return (
          <g key={item.step.name}>
            {/* Bar */}
            <g>
              <rect
                x="0"
                y={yOffset}
                width={item.barWidth}
                height={barHeight}
                fill={item.color}
                rx="4"
              />
              {/* Label + count + percent on bar */}
              <text x={12} y={yOffset + 18} fontSize="13" fontWeight="600" fill="white">
                {item.step.label}
              </text>
              <text x={12} y={yOffset + 36} fontSize="11" fill="rgba(255,255,255,0.85)">
                {item.step.count.toLocaleString("pt-BR")} ({item.step.percentage.toFixed(0)}%)
              </text>
            </g>

            {/* Drop-off arrow + label (if not last) */}
            {item.transition && idx < chartData.length - 1 && (
              <g>
                <line
                  x1={arrowX}
                  y1={yOffset + barHeight + 5}
                  x2={arrowX}
                  y2={yOffset + gapY - 25}
                  stroke="#999"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowDown)"
                />
                <text
                  x={arrowX + 12}
                  y={yOffset + barHeight + 35}
                  fontSize="11"
                  fill="#ef4444"
                  fontWeight="600"
                >
                  ↓ {(item.transition.dropOff * 100).toFixed(0)}% saiu
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
