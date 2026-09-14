import type { ReactNode } from "react";
import { PerimeterBorder } from "./PerimeterBorder";

interface ShimmerBorderProps { children: ReactNode; radius?: string | number; }

export function ShimmerBorder({ children, radius = "var(--aacp-radius, 19px)" }: ShimmerBorderProps) {
  const r = typeof radius === "number" ? radius + "px" : radius;
  return (
    <div className="shimmer-border-wrap" style={{ position: "relative", flex: 1, minHeight: 0, borderRadius: r, padding: "1px" }}>
      <PerimeterBorder radius={r} />
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: "calc(" + r + " - 1px)", overflow: "hidden", background: "var(--bg, var(--aacp-bg))", zIndex: 2 }}>
        {children}
      </div>
    </div>
  );
}
