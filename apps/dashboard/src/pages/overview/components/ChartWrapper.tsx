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
      { ...options, width: rect.width, height: rect.height },
      data,
      container,
    );
    plotRef.current = plot;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        plot.setSize({ width, height });
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

  return <div ref={containerRef} className={className} style={style} />;
}
