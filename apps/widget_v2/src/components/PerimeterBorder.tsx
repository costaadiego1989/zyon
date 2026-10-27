import type { CSSProperties } from "react";

/** Shared decorative shimmer, clipped to a single 1px rounded contour. */
export function PerimeterBorder({ radius = "19px", variant = "container" }: {
  radius?: string | number;
  variant?: "container" | "input";
}) {
  const r = typeof radius === "number" ? radius + "px" : radius;
  return <span className="aacp-perimeter" data-perimeter={variant} aria-hidden="true"
    style={{ "--aacp-perimeter-radius": r } as CSSProperties} />;
}
