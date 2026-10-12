import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface ChartWrapperProps {
  options: uPlot.Options;
  data: uPlot.AlignedData;
  className?: string;
  style?: React.CSSProperties;
}

export function ChartWrapper({ options, data, className, style }: ChartWrapperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const plot = new uPlot(
      { ...options, width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) },
      data,
      container,
    );
    plotRef.current = plot;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) plot.setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
      plot.destroy();
      plotRef.current = null;
    };
  }, [options, data]);

  return <div ref={containerRef} className={className} style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden", ...style }} />;
}
