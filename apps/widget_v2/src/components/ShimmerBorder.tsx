import type { ReactNode } from "react";

interface ShimmerBorderProps {
  children: ReactNode;
  radius?: string | number;
}

/**
 * Container with animated shimmer border that travels around the full perimeter.
 * Uses a rotating conic-gradient masked to the border area.
 */
export function ShimmerBorder({ children, radius = "var(--aacp-radius, 19px)" }: ShimmerBorderProps) {
  const r = typeof radius === "number" ? `${radius}px` : radius;

  return (
    <div
      className="shimmer-border-wrap"
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        borderRadius: r,
        padding: "1.5px",
      }}
    >
      {/* Rotating conic gradient border — travels full perimeter */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: r,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "-50%",
            background: "conic-gradient(from var(--shimmer-angle, 0deg), transparent 0%, transparent 70%, var(--aacp-accent, #0f766e) 80%, transparent 90%, transparent 100%)",
            animation: "shimmerRotate 4s linear infinite",
            opacity: 0.8,
          }}
        />
        {/* Inner mask: cut out center to show only border */}
        <div
          style={{
            position: "absolute",
            inset: "1.5px",
            borderRadius: `calc(${r} - 1.5px)`,
            background: "var(--bg, #0d1117)",
          }}
        />
      </div>

      {/* Static subtle border */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: r,
          border: "1px solid var(--bd, rgba(255,255,255,0.08))",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: `calc(${r} - 1.5px)`,
          overflow: "hidden",
          background: "var(--bg, #0d1117)",
          zIndex: 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}
